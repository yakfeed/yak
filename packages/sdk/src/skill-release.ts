// A skill version's files and its manifest. Pure: the caller
// reads the source and writes the result (tools/skill-release). The same inputs always give the
// same bytes, so CI can rebuild a version and check it against the signed manifest.
import { buildArchive } from "./skill-archive.js";
import { FORMAT_VERSION, STATEMENT_TYPES, sha256Hex } from "./signing.js";
import type { ManifestFile, SkillManifest } from "./signing.js";

export const SKILL_NAME = "yakfeed";
/** The `/skill.md` alias: the same bytes as SKILL.md, listed on its own because it's served on its own. */
export const SKILL_ALIAS = "skill.md";
export const SKILL_ENTRY = "SKILL.md";
export const MANIFEST_FILE = "manifest.json";
export const SIGNATURE_FILE = "manifest.json.sig";
export const archiveName = (version: string): string => `${SKILL_NAME}-${version}.tar`;

/** MAJOR.MINOR.PATCH, nothing else: versions sort, and each one's URL is immutable. */
export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Compares two skill versions: negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION_PATTERN.exec(a);
  const pb = VERSION_PATTERN.exec(b);
  if (!pa || !pb) throw new Error(`Not a skill version: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

export interface SkillRelease {
  version: string;
  /** Manifest path → bytes: SKILL.md, references/…, and the skill.md alias. */
  files: Map<string, Buffer>;
  archive: { path: string; bytes: Buffer };
}

/**
 * Builds a version from its source files (paths relative to the skill folder: SKILL.md and
 * references/*.md; nothing else is allowed, so no script can ride along).
 */
export function buildRelease(version: string, source: ReadonlyMap<string, Uint8Array>): SkillRelease {
  if (!VERSION_PATTERN.test(version)) throw new Error(`Not a skill version (MAJOR.MINOR.PATCH): ${version}`);
  const entry = source.get(SKILL_ENTRY);
  if (!entry) throw new Error(`The skill has no ${SKILL_ENTRY}.`);
  for (const path of source.keys()) {
    if (path !== SKILL_ENTRY && !/^references\/[a-z0-9][a-z0-9-]*\.md$/.test(path)) throw new Error(`Only ${SKILL_ENTRY} and references/*.md belong in the skill: ${path}`);
  }
  const files = new Map<string, Buffer>([...source].map(([p, b]) => [p, Buffer.from(b)]));
  const archive = buildArchive(SKILL_NAME, [...files].map(([path, bytes]) => ({ path, bytes })));
  files.set(SKILL_ALIAS, Buffer.from(entry));
  return { version, files: new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))), archive: { path: archiveName(version), bytes: archive } };
}

const fileEntry = (path: string, bytes: Uint8Array): ManifestFile => ({ path, sha256: sha256Hex(bytes), size: bytes.length });

/** The unsigned manifest for a release; signStatement fills in keyId. */
export function manifestFor(release: SkillRelease, at: { origin: string; seq: number; issuedAt: string }): Omit<SkillManifest, "keyId"> {
  return {
    type: STATEMENT_TYPES.skill,
    v: FORMAT_VERSION,
    origin: at.origin,
    seq: at.seq,
    issuedAt: at.issuedAt,
    name: SKILL_NAME,
    version: release.version,
    files: [...release.files].map(([p, b]) => fileEntry(p, b)),
    archive: fileEntry(release.archive.path, release.archive.bytes),
  };
}
