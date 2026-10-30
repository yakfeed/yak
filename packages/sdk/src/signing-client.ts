// Fetching and verifying what yakfeed signs: the trust state for an API (production's
// bundled keys, or another environment's pinned on first use), rotation notices, the agent brief,
// and a skill version. The MCP server and `yak skill check` use these; any agent can.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { PRODUCTION_ORIGIN, SignatureError, applyRotation, originOf, pinOnFirstUse, verifyBrief, verifySkill } from "./signing.js";
import type { Keyset, SignedStatement, SkillManifest, TrustState } from "./signing.js";
import { MANIFEST_FILE, SIGNATURE_FILE, SKILL_ALIAS } from "./skill-release.js";
import type { TrustStore } from "./trust-store.js";

type Fetch = typeof fetch;

interface KeysDocument extends Keyset {
  rotations?: SignedStatement[];
}

async function keysDocument(baseUrl: string, f: Fetch): Promise<KeysDocument | null> {
  const res = await f(new URL("/v1/signing/keys", baseUrl)).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as KeysDocument;
}

/**
 * The trust state to check this API's statements with: production's bundled keys (never the
 * server's word for them), or for another environment the keys pinned on first use. Rotation
 * notices the API serves are applied when they're new and signed by a pinned recovery key; a bad
 * notice is skipped, never trusted. Saved to the store.
 */
export async function trustFor(baseUrl: string, store: TrustStore, f: Fetch = fetch): Promise<TrustState> {
  const origin = originOf(baseUrl);
  const pinned = store.load(origin);
  const doc = await keysDocument(baseUrl, f);
  let trust = pinOnFirstUse(pinned, origin, origin === PRODUCTION_ORIGIN || pinned ? null : doc);
  for (const notice of doc?.rotations ?? []) {
    try {
      trust = applyRotation(trust, notice);
    } catch {
      // Already applied (a lower seq), or not from a pinned recovery key: changes nothing.
    }
  }
  store.save(trust);
  return trust;
}

export interface VerifiedBriefText {
  version: number;
  text: string;
}

/**
 * The agent brief in force, only if its signature checks against the pinned keys, for this API's
 * origin, with a version no lower than one loaded before. Throws SignatureError otherwise (and an
 * Error when there's no brief to read), so a caller can never use an unchecked one.
 */
export async function fetchVerifiedBrief(baseUrl: string, store: TrustStore, f: Fetch = fetch): Promise<VerifiedBriefText> {
  const res = await f(new URL("/v1/policies/agent-brief", baseUrl));
  if (!res.ok) throw new Error(`No agent brief (${res.status}).`);
  const brief = (await res.json()) as { version: number; text: string; signed: SignedStatement | null };
  return checkBrief(baseUrl, store, brief, f);
}

/** Checks a brief already fetched (from a policy version, say) the same way. */
export async function checkBrief(baseUrl: string, store: TrustStore, brief: { version: number; text: string; signed?: SignedStatement | null }, f: Fetch = fetch): Promise<VerifiedBriefText> {
  if (!brief.signed) throw new SignatureError("malformed", "The agent brief isn't signed.");
  const trust = await trustFor(baseUrl, store, f);
  const verified = verifyBrief({ text: brief.text, version: brief.version, signed: brief.signed, trust });
  store.save(verified.trust);
  return { version: brief.version, text: brief.text };
}

/** The manifest, once its signature, origin, key and seq check (no files yet). */
function signedManifest(manifest: Buffer, signature: Buffer, trust: TrustState): SkillManifest {
  return verifySkill({ manifest, signature, trust }).manifest;
}

/** Files the OS may add to a folder, which aren't part of a skill copy. */
const IGNORED = new Set([".DS_Store"]);

/** Every file under a folder, as paths relative to it with `/`. */
function filesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((e) => {
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    return e.isDirectory() ? filesUnder(dir, path) : [path];
  });
}

export interface CheckedSkill {
  manifest: SkillManifest;
  trust: TrustState;
  /** Files checked, by manifest path. */
  checked: string[];
}

/**
 * Checks a skill version: from an installed copy (`dir`, holding manifest.json, its
 * .sig and the files) or from the web (`webUrl` and `version`, every file and the archive). The
 * manifest's signature, origin, key and seq against the pinned trust state, and every file's
 * sha256. Saves the new state only when it all checks.
 */
export async function checkSkill(input: { apiUrl: string; store: TrustStore; dir?: string; webUrl?: string; version?: string; fetch?: Fetch }): Promise<CheckedSkill> {
  const f = input.fetch ?? fetch;
  const trust = await trustFor(input.apiUrl, input.store, f);
  let manifest: Buffer;
  let signature: Buffer;
  const files: Record<string, Buffer> = {};
  let archive: Buffer | null = null;
  if (input.dir) {
    const at = (p: string) => join(input.dir!, p);
    if (!existsSync(at(MANIFEST_FILE)) || !existsSync(at(SIGNATURE_FILE))) throw new SignatureError("missing_file", `${MANIFEST_FILE} and ${SIGNATURE_FILE} in ${input.dir}`);
    manifest = readFileSync(at(MANIFEST_FILE));
    signature = readFileSync(at(SIGNATURE_FILE));
    const listed = signedManifest(manifest, signature, trust);
    // The copy is exactly what was signed: every listed file is there, and nothing
    // else is (an extra file could carry instructions an agent loads). The archive, and the
    // `skill.md` alias (served on the web on its own), are optional here.
    for (const file of listed.files) {
      if (file.path === SKILL_ALIAS) {
        if (existsSync(at(file.path)) && readdirSync(input.dir).includes(SKILL_ALIAS)) files[file.path] = readFileSync(at(file.path));
        continue;
      }
      if (!existsSync(at(file.path))) throw new SignatureError("missing_file", file.path);
      files[file.path] = readFileSync(at(file.path));
    }
    if (existsSync(at(listed.archive.path))) archive = readFileSync(at(listed.archive.path));
    const expected = new Set([MANIFEST_FILE, SIGNATURE_FILE, listed.archive.path, ...listed.files.map((f) => f.path)]);
    for (const path of filesUnder(input.dir)) if (!expected.has(path) && !IGNORED.has(basename(path))) throw new SignatureError("unlisted_file", path);
  } else {
    if (!input.webUrl || !input.version) throw new Error("Give an installed copy's folder, or the web address and a version.");
    const base = new URL(`/.well-known/agent-skills/yakfeed/${input.version}/`, input.webUrl);
    const get = async (p: string) => {
      // Only paths inside this version's folder on this site: a listed path that
      // resolves elsewhere is never fetched, so the gateway's headers can't go to another host.
      const url = new URL(p, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new SignatureError("unlisted_file", `${p} is outside ${base.href}`);
      const res = await f(url);
      if (!res.ok) throw new SignatureError("missing_file", `${p} (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    };
    manifest = await get(MANIFEST_FILE);
    signature = await get(SIGNATURE_FILE);
    // The manifest's signature is checked before anything it lists is fetched.
    const listed = signedManifest(manifest, signature, trust);
    for (const file of listed.files) files[file.path] = await get(file.path);
    archive = await get(listed.archive.path);
  }
  const verified = verifySkill({ manifest, signature, trust, files, archive, complete: !input.dir });
  input.store.save(verified.trust);
  return { manifest: verified.manifest, trust: verified.trust, checked: Object.keys(files) };
}
