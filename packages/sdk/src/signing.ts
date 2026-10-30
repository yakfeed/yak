// Signed statements from yakfeed: the skill's manifest, the agent
// brief, and key rotation notices. One envelope for all three: a small JSON statement, signed as
// its exact bytes with pure Ed25519 (KMS: ECC_NIST_EDWARDS25519, ED25519_SHA_512, RAW), and a
// detached signature beside it. Agents pin the keys on first use, and reject another origin, a
// lower seq, or a key they haven't pinned. Verification lives here, in code, because a model that
// "verifies" in prose will say it did.
//
// Node only (node:crypto), so it's its own entry point: `@yakfeed/sdk/signing`.
import { createHash, createPrivateKey, createPublicKey, sign as signBytes, verify as verifySignature } from "node:crypto";
import { PRODUCTION_KEYSET, PRODUCTION_ORIGIN } from "./signing-keys.js";

export { PRODUCTION_KEYSET, PRODUCTION_ORIGIN };

/** The only algorithm: pure Ed25519 over the statement's bytes (never the prehashed variant). */
export const SIGNING_ALG = "ed25519" as const;
/** KMS's raw-message limit: a statement must fit, so the skill's files are listed, never signed whole. */
export const STATEMENT_MAX_BYTES = 4096;
/** The format version every statement and signature carries. */
export const FORMAT_VERSION = 1;

export const STATEMENT_TYPES = { skill: "yakfeed.skill-manifest", brief: "yakfeed.agent-brief", rotation: "yakfeed.key-rotation" } as const;
export type StatementType = (typeof STATEMENT_TYPES)[keyof typeof STATEMENT_TYPES];

/** A public key, as `signingKeys` lists it in the discovery document. */
export interface SigningKey {
  /** `yk-` and the first 16 hex characters of the sha256 of the raw public key (keyIdFor). */
  id: string;
  alg: typeof SIGNING_ALG;
  /** Base64 of the raw 32-byte Ed25519 public key. */
  publicKey: string;
  /** From when statements signed with it count (ISO 8601). */
  notBefore: string;
}

/** The keys one environment signs with, and the recovery keys that sign its rotation notices. */
export interface Keyset {
  /** The API host its statements name (`api.yakfeed.com` in production). */
  origin: string;
  /** False for staging, the preview and development: never trusted as production. */
  production: boolean;
  signingKeys: SigningKey[];
  recoveryKeys: SigningKey[];
}

/** Fields every statement has. */
interface StatementBase {
  type: StatementType;
  v: typeof FORMAT_VERSION;
  origin: string;
  /** Always increasing, per type: a lower one is a rollback or a replay. */
  seq: number;
  issuedAt: string;
  /** The key that signed it. */
  keyId: string;
}

export interface ManifestFile {
  path: string;
  sha256: string;
  size: number;
}

/** A skill version: the sha256 of every file and of the version's archive. */
export interface SkillManifest extends StatementBase {
  type: typeof STATEMENT_TYPES.skill;
  name: string;
  version: string;
  files: ManifestFile[];
  archive: ManifestFile;
}

/** An agent brief version: its seq is its version. */
export interface BriefStatement extends StatementBase {
  type: typeof STATEMENT_TYPES.brief;
  version: number;
  sha256: string;
}

/** "The signing key is now newKey from effectiveAt; the next recovery key is nextRecoveryKey." Signed by the recovery key. */
export interface RotationNotice extends StatementBase {
  type: typeof STATEMENT_TYPES.rotation;
  oldKeyId: string;
  newKey: SigningKey;
  nextRecoveryKey: SigningKey;
  effectiveAt: string;
}

export type Statement = SkillManifest | BriefStatement | RotationNotice;

/** The detached signature: `manifest.json.sig` beside `manifest.json`, or `signature` in an envelope. */
export interface SignatureFile {
  v: typeof FORMAT_VERSION;
  alg: typeof SIGNING_ALG;
  keyId: string;
  /** Base64 of the 64-byte signature. */
  signature: string;
}

/** A statement and its signature in one JSON value: the brief's and the rotation notices' shape. */
export interface SignedStatement {
  /** The statement's exact text: the bytes that were signed. */
  statement: string;
  signature: SignatureFile;
}

/** Why a statement was refused. Each is a reason to stop and report, never to retry another way. */
export const REFUSALS = {
  malformed: "The statement or its signature isn't in yakfeed's format.",
  too_large: `A statement is at most ${STATEMENT_MAX_BYTES} bytes.`,
  wrong_type: "This statement is a different kind (a brief where a skill manifest was expected, or the other way round).",
  wrong_origin: "The statement names another origin: it's for a different yakfeed environment, or not from yakfeed.",
  unpinned_key: "Signed by a key you haven't pinned. A new key counts only after a rotation notice signed by the recovery key.",
  bad_signature: "The signature doesn't match the statement and the key it names.",
  key_not_yet_valid: "Issued before its key's notBefore.",
  expired_key: "Issued after its key was retired by a rotation notice.",
  lower_seq: "Its seq is lower than one already accepted: a rollback or a replay.",
  seq_reused: "Its seq was already accepted for different bytes.",
  digest_mismatch: "A file's sha256 doesn't match the manifest.",
  missing_file: "A file the manifest lists is missing.",
  unlisted_file: "A file isn't in the manifest.",
} as const;
export type Refusal = keyof typeof REFUSALS;

export class SignatureError extends Error {
  constructor(
    readonly reason: Refusal,
    detail?: string,
  ) {
    super(detail ? `${REFUSALS[reason]} ${detail}` : REFUSALS[reason]);
    this.name = "SignatureError";
  }
}

/**
 * What an agent keeps between runs, per origin: the keys it pinned,
 * keys retired by rotation notices, and the highest seq it accepted of each kind. Without it, an
 * agent can't tell a rollback from an update, so it doesn't adopt updates.
 */
export interface TrustState {
  origin: string;
  production: boolean;
  signingKeys: SigningKey[];
  recoveryKeys: SigningKey[];
  /** Key id → when a rotation notice retired it. */
  retired: Record<string, string>;
  seq: { skill: number; brief: number; rotation: number };
  /** The sha256 of each accepted statement at its seq, so the same statement can be checked again. */
  accepted: { skill: string | null; brief: string | null };
  /** The skill version accepted last. */
  skillVersion: string | null;
}

export const sha256Hex = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

const fromBase64 = (s: string): Buffer => Buffer.from(s, "base64");

/** A key's id from its public key, so an id can't be pinned to the wrong key. */
export function keyIdFor(publicKey: string): string {
  return `yk-${sha256Hex(fromBase64(publicKey)).slice(0, 16)}`;
}

/** The raw public key (base64) from a DER SubjectPublicKeyInfo, as KMS's GetPublicKey returns it. */
export function rawPublicKeyFromSpki(der: Uint8Array): string {
  const jwk = createPublicKey({ key: Buffer.from(der), format: "der", type: "spki" }).export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || !jwk.x) throw new SignatureError("malformed", "Not an Ed25519 public key.");
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

const isKey = (k: unknown): k is SigningKey => {
  if (!k || typeof k !== "object") return false;
  const key = k as Record<string, unknown>;
  return typeof key.id === "string" && key.alg === SIGNING_ALG && typeof key.publicKey === "string" && fromBase64(key.publicKey).length === 32 && typeof key.notBefore === "string" && !Number.isNaN(Date.parse(key.notBefore)) && keyIdFor(key.publicKey) === key.id;
};

/** A trust state from a keyset: what an agent pins on first use. Production's comes bundled. */
export function trustFrom(keyset: Keyset): TrustState {
  for (const k of [...keyset.signingKeys, ...keyset.recoveryKeys]) if (!isKey(k)) throw new SignatureError("malformed", `Key ${JSON.stringify(k)} isn't valid (its id must be keyIdFor(publicKey)).`);
  return {
    origin: keyset.origin,
    production: keyset.production,
    signingKeys: keyset.signingKeys.map((k) => ({ ...k })),
    recoveryKeys: keyset.recoveryKeys.map((k) => ({ ...k })),
    retired: {},
    seq: { skill: 0, brief: 0, rotation: 0 },
    accepted: { skill: null, brief: null },
    skillVersion: null,
  };
}

/** Production's trust state from the keys bundled in this package. */
export const productionTrust = (): TrustState => trustFrom(PRODUCTION_KEYSET);

/** The origin a base URL's statements name: its host (with any port). */
export const originOf = (baseUrl: string): string => new URL(baseUrl).host;

const bytesOf = (b: Uint8Array | string): Buffer => (typeof b === "string" ? Buffer.from(b, "utf8") : Buffer.from(b));

/** Parses a signature file (`manifest.json.sig`). */
export function parseSignature(raw: Uint8Array | string | SignatureFile): SignatureFile {
  let sig: unknown = raw;
  if (typeof raw === "string" || raw instanceof Uint8Array) {
    try {
      sig = JSON.parse(bytesOf(raw).toString("utf8"));
    } catch {
      throw new SignatureError("malformed", "The signature file isn't JSON.");
    }
  }
  const s = sig as Partial<SignatureFile>;
  if (!s || s.v !== FORMAT_VERSION || s.alg !== SIGNING_ALG || typeof s.keyId !== "string" || typeof s.signature !== "string" || fromBase64(s.signature).length !== 64) {
    throw new SignatureError("malformed", "The signature file needs v 1, alg ed25519, keyId and a 64-byte signature.");
  }
  return { v: s.v, alg: s.alg, keyId: s.keyId, signature: s.signature };
}

function parseStatement(bytes: Buffer): Statement {
  if (bytes.length > STATEMENT_MAX_BYTES) throw new SignatureError("too_large", `This one is ${bytes.length}.`);
  let s: unknown;
  try {
    s = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new SignatureError("malformed", "The statement isn't JSON.");
  }
  const st = s as Partial<StatementBase>;
  if (!st || st.v !== FORMAT_VERSION || !Object.values(STATEMENT_TYPES).includes(st.type as StatementType) || typeof st.origin !== "string" || !Number.isSafeInteger(st.seq) || (st.seq as number) < 1 || typeof st.issuedAt !== "string" || Number.isNaN(Date.parse(st.issuedAt)) || typeof st.keyId !== "string") {
    throw new SignatureError("malformed", "A statement needs type, v 1, origin, seq (1 or more), issuedAt and keyId.");
  }
  return s as Statement;
}

/** Which seq in the trust state each statement type advances. */
const SEQ_FOR: Record<StatementType, keyof TrustState["seq"]> = { [STATEMENT_TYPES.skill]: "skill", [STATEMENT_TYPES.brief]: "brief", [STATEMENT_TYPES.rotation]: "rotation" };

/** When a key stopped counting (a rotation notice retired it), or null. */
const retiredAt = (trust: TrustState, keyId: string): number | null => (trust.retired[keyId] ? Date.parse(trust.retired[keyId]) : null);

/**
 * The checks every statement passes: size, format, type, origin, a pinned key valid when it was
 * issued, and the signature over its exact bytes. Returns the parsed statement.
 */
function checkStatement(bytes: Buffer, signature: SignatureFile, trust: TrustState, type: StatementType, keys: SigningKey[]): Statement {
  const statement = parseStatement(bytes);
  if (statement.type !== type) throw new SignatureError("wrong_type", `Expected ${type}, got ${statement.type}.`);
  if (statement.origin !== trust.origin) throw new SignatureError("wrong_origin", `It names ${statement.origin}; you're using ${trust.origin}.`);
  if (signature.keyId !== statement.keyId) throw new SignatureError("malformed", "The signature and the statement name different keys.");
  const key = keys.find((k) => k.id === statement.keyId);
  if (!key) throw new SignatureError("unpinned_key", `Key ${statement.keyId}.`);
  const issued = Date.parse(statement.issuedAt);
  if (issued < Date.parse(key.notBefore)) throw new SignatureError("key_not_yet_valid", `Key ${key.id} counts from ${key.notBefore}.`);
  const retired = retiredAt(trust, key.id);
  if (retired !== null && issued >= retired) throw new SignatureError("expired_key", `Key ${key.id} was retired at ${trust.retired[key.id]}.`);
  // Once its retirement has taken effect, a retired key signs nothing new, whatever `issuedAt` it
  // claims: someone holding a compromised key could backdate one. It can still
  // re-check a statement already accepted (the same seq; checkSeq then wants the same bytes).
  if (retired !== null && Date.now() >= retired && statement.seq > trust.seq[SEQ_FOR[type]]) {
    throw new SignatureError("expired_key", `Key ${key.id} was retired at ${trust.retired[key.id]}: nothing it signs is new any more.`);
  }
  const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: fromBase64(key.publicKey).toString("base64url") }, format: "jwk" });
  if (!verifySignature(null, bytes, publicKey, fromBase64(signature.signature))) throw new SignatureError("bad_signature");
  return statement;
}

/** A higher seq is new; the same seq passes only for the same bytes (checking an accepted one again). */
function checkSeq(seq: number, last: number, acceptedHash: string | null, hash: string): void {
  if (seq < last) throw new SignatureError("lower_seq", `Seq ${seq}; you accepted ${last}.`);
  if (seq === last && acceptedHash !== hash) throw new SignatureError("seq_reused", `Seq ${seq}.`);
}

export interface VerifiedSkill {
  manifest: SkillManifest;
  /** The trust state to keep: save it, or the next check can't catch a rollback. */
  trust: TrustState;
}

/**
 * Verifies a skill version: the manifest's signature, origin, key and seq, and the sha256 of each
 * file given (`files` by manifest path, and the archive's bytes). With `complete`, every file the
 * manifest lists must be given. Throws SignatureError; never returns a partly checked result.
 */
export function verifySkill(input: {
  manifest: Uint8Array | string;
  signature: Uint8Array | string | SignatureFile;
  trust: TrustState;
  files?: Record<string, Uint8Array | string>;
  archive?: Uint8Array | null;
  complete?: boolean;
}): VerifiedSkill {
  const bytes = bytesOf(input.manifest);
  const manifest = checkStatement(bytes, parseSignature(input.signature), input.trust, STATEMENT_TYPES.skill, input.trust.signingKeys) as SkillManifest;
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string" || !Array.isArray(manifest.files) || !manifest.archive) throw new SignatureError("malformed", "A skill manifest needs name, version, files and archive.");
  const hash = sha256Hex(bytes);
  checkSeq(manifest.seq, input.trust.seq.skill, input.trust.accepted.skill, hash);
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  for (const [path, content] of Object.entries(input.files ?? {})) {
    const entry = listed.get(path);
    if (!entry) throw new SignatureError("unlisted_file", path);
    if (sha256Hex(bytesOf(content)) !== entry.sha256) throw new SignatureError("digest_mismatch", path);
  }
  if (input.archive && sha256Hex(input.archive) !== manifest.archive.sha256) throw new SignatureError("digest_mismatch", manifest.archive.path);
  if (input.complete) {
    for (const f of manifest.files) if (!(input.files && f.path in input.files)) throw new SignatureError("missing_file", f.path);
    if (!input.archive) throw new SignatureError("missing_file", manifest.archive.path);
  }
  return { manifest, trust: { ...input.trust, seq: { ...input.trust.seq, skill: manifest.seq }, accepted: { ...input.trust.accepted, skill: hash }, skillVersion: manifest.version } };
}

export interface VerifiedBrief {
  statement: BriefStatement;
  trust: TrustState;
}

/**
 * Verifies an agent brief against its signed statement: origin, a pinned key, a seq
 * (its version) no lower than one accepted, and the text's sha256. The MCP server and `yak`
 * refuse a brief that fails; nothing else of it is used.
 */
export function verifyBrief(input: { text: string; version: number; signed: SignedStatement; trust: TrustState }): VerifiedBrief {
  if (!input.signed || typeof input.signed.statement !== "string") throw new SignatureError("malformed", "The brief has no signed statement.");
  const bytes = bytesOf(input.signed.statement);
  const statement = checkStatement(bytes, parseSignature(input.signed.signature), input.trust, STATEMENT_TYPES.brief, input.trust.signingKeys) as BriefStatement;
  if (statement.version !== input.version || statement.seq !== statement.version) throw new SignatureError("malformed", `The statement is for brief version ${statement.version}; this is ${input.version}.`);
  if (sha256Hex(input.text) !== statement.sha256) throw new SignatureError("digest_mismatch", "The brief's text.");
  const hash = sha256Hex(bytes);
  checkSeq(statement.seq, input.trust.seq.brief, input.trust.accepted.brief, hash);
  return { statement, trust: { ...input.trust, seq: { ...input.trust.seq, brief: statement.seq }, accepted: { ...input.trust.accepted, brief: hash } } };
}

/**
 * Applies a rotation notice: signed by a pinned recovery key, a higher seq than the last notice,
 * retiring a pinned signing key. The new signing key counts from effectiveAt; the old one stops
 * then; the next recovery key replaces the one that signed. Returns the trust state to keep.
 */
export function applyRotation(trust: TrustState, signed: SignedStatement): TrustState {
  if (!signed || typeof signed.statement !== "string") throw new SignatureError("malformed", "The rotation notice has no statement.");
  const bytes = bytesOf(signed.statement);
  const notice = checkStatement(bytes, parseSignature(signed.signature), trust, STATEMENT_TYPES.rotation, trust.recoveryKeys) as RotationNotice;
  if (!isKey(notice.newKey) || !isKey(notice.nextRecoveryKey) || typeof notice.oldKeyId !== "string" || Number.isNaN(Date.parse(notice.effectiveAt))) throw new SignatureError("malformed", "A rotation notice needs oldKeyId, newKey, nextRecoveryKey and effectiveAt.");
  if (notice.seq <= trust.seq.rotation) throw new SignatureError("lower_seq", `Notice ${notice.seq}; you applied ${trust.seq.rotation}.`);
  if (!trust.signingKeys.some((k) => k.id === notice.oldKeyId)) throw new SignatureError("unpinned_key", `The notice retires ${notice.oldKeyId}, which you haven't pinned.`);
  const newKey = { ...notice.newKey, notBefore: notice.effectiveAt };
  return {
    ...trust,
    signingKeys: [...trust.signingKeys.filter((k) => k.id !== newKey.id), newKey],
    recoveryKeys: [{ ...notice.nextRecoveryKey }],
    retired: { ...trust.retired, [notice.oldKeyId]: notice.effectiveAt, [notice.keyId]: notice.issuedAt },
    seq: { ...trust.seq, rotation: notice.seq },
  };
}

/** The statement's exact bytes for signing: JSON with two-space indents and a final newline. */
export function statementBytes(statement: Statement): Buffer {
  const text = `${JSON.stringify(statement, null, 2)}\n`;
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > STATEMENT_MAX_BYTES) throw new SignatureError("too_large", `This one is ${bytes.length}.`);
  return bytes;
}

/** A signature file's bytes, as `manifest.json.sig` holds them. */
export function signatureFileBytes(sig: SignatureFile): Buffer {
  return Buffer.from(`${JSON.stringify(sig, null, 2)}\n`, "utf8");
}

/** A signer: KMS in production and staging, a local key in development and tests. */
export interface Signer {
  keyId: string;
  sign(bytes: Uint8Array): Promise<Uint8Array>;
}

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * A signer from a local Ed25519 private key (base64 of the 32-byte seed): development, tests and
 * the test vectors only. Production and staging sign in KMS, where the key can't leave.
 */
export function localSigner(seed: string, notBefore = "2026-01-01T00:00:00.000Z"): Signer & { key: SigningKey } {
  const raw = fromBase64(seed);
  if (raw.length !== 32) throw new SignatureError("malformed", "A local key is base64 of a 32-byte Ed25519 seed.");
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, raw]), format: "der", type: "pkcs8" });
  const x = createPublicKey(privateKey).export({ format: "jwk" }).x!;
  const publicKey = Buffer.from(x, "base64url").toString("base64");
  const key: SigningKey = { id: keyIdFor(publicKey), alg: SIGNING_ALG, publicKey, notBefore };
  return { keyId: key.id, key, sign: async (bytes) => signBytes(null, Buffer.from(bytes), privateKey) };
}

/** Signs a statement (its keyId set to the signer's) and returns its bytes and the signature file. */
export async function signStatement<T extends Statement>(signer: Signer, statement: Omit<T, "keyId">): Promise<{ bytes: Buffer; signature: SignatureFile }> {
  const bytes = statementBytes({ ...statement, keyId: signer.keyId } as unknown as Statement);
  const raw = await signer.sign(bytes);
  if (raw.length !== 64) throw new SignatureError("malformed", "The signer returned something other than a 64-byte Ed25519 signature.");
  return { bytes, signature: { v: FORMAT_VERSION, alg: SIGNING_ALG, keyId: signer.keyId, signature: Buffer.from(raw).toString("base64") } };
}

/** Pins what a server offers for a non-production origin, or keeps the pinned state; production always starts from the bundled keys. */
export function pinOnFirstUse(pinned: TrustState | null, origin: string, offered: Keyset | null, bundled: TrustState = productionTrust()): TrustState {
  if (origin === PRODUCTION_ORIGIN) {
    if (!pinned) return bundled;
    // A newer package may bundle keys a rotation already added; never drop a pinned one.
    const ids = new Set(pinned.signingKeys.map((k) => k.id));
    // A state saved before the key ceremony has no recovery keys: take the bundled ones, or no
    // rotation notice could ever be applied. A rotation's next recovery key stays.
    const recoveryKeys = pinned.recoveryKeys.length > 0 ? pinned.recoveryKeys : bundled.recoveryKeys;
    return { ...pinned, production: true, signingKeys: [...pinned.signingKeys, ...bundled.signingKeys.filter((k) => !ids.has(k.id) && !pinned.retired[k.id])], recoveryKeys };
  }
  if (pinned) return pinned;
  if (!offered) throw new SignatureError("unpinned_key", `No keys pinned for ${origin}, and none offered.`);
  if (offered.production) throw new SignatureError("wrong_origin", `${origin} isn't production but says its keys are.`);
  return trustFrom({ ...offered, origin, production: false });
}
