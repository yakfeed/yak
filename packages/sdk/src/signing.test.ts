import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FORMAT_VERSION,
  PRODUCTION_KEYSET,
  PRODUCTION_ORIGIN,
  STATEMENT_TYPES,
  SignatureError,
  applyRotation,
  buildArchive,
  buildRelease,
  buildVectors,
  compareVersions,
  fileTrustStore,
  keyIdFor,
  localSigner,
  manifestFor,
  pinOnFirstUse,
  rawPublicKeyFromSpki,
  readArchive,
  runVector,
  signStatement,
  statementBytes,
  trustFrom,
  verifySkill,
} from "./signing-entry.js";
import type { BriefStatement, RotationNotice, SigningVector, VectorSeeds } from "./signing-entry.js";

const VECTORS = new URL("../test-vectors/signing/", import.meta.url);
/** Fixed seeds from a label: the vectors' keys, public on purpose. */
const seed = (label: string) => createHash("sha256").update(`yakfeed test vector key: ${label}`).digest("base64");
const SEEDS: VectorSeeds = { signing: seed("signing"), next: seed("next"), recovery: seed("recovery"), nextRecovery: seed("next recovery"), stranger: seed("stranger") };

describe("the published test vectors", () => {
  it("match the committed files, byte for byte (UPDATE_VECTORS=1 rewrites them)", async () => {
    const vectors = await buildVectors(SEEDS);
    const dir = new URL(VECTORS);
    if (process.env.UPDATE_VECTORS === "1") {
      mkdirSync(dir, { recursive: true });
      writeFileSync(new URL("keys.json", dir), `${JSON.stringify({ note: "The test vectors' keys: seeds are sha256('yakfeed test vector key: <label>'). Public on purpose; never trusted anywhere real.", ...SEEDS }, null, 2)}\n`);
      for (const v of vectors) writeFileSync(new URL(`${v.name}.json`, dir), `${JSON.stringify(v, null, 2)}\n`);
    }
    const committed = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "keys.json");
    expect(committed.sort()).toEqual(vectors.map((v) => `${v.name}.json`).sort());
    for (const v of vectors) expect(readFileSync(new URL(`${v.name}.json`, dir), "utf8"), v.name).toBe(`${JSON.stringify(v, null, 2)}\n`);
  });

  it("each gives its expected answer", () => {
    const dir = new URL(VECTORS);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "keys.json")) {
      const v = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as SigningVector;
      expect(runVector(v), v.name).toEqual(v.expect);
    }
  });

  it("covers valid, expired, wrong key, wrong origin, lower seq and an unannounced key change", async () => {
    const names = (await buildVectors(SEEDS)).map((v) => v.name);
    for (const n of ["valid", "expired", "wrong-key", "wrong-origin", "lower-seq", "unannounced-key-change"]) expect(names).toContain(n);
  });
});

describe("signing and verifying", () => {
  const signer = localSigner(seed("signing"));
  const recovery = localSigner(seed("recovery"));
  const keyset = { origin: "api.example.test", production: false, signingKeys: [signer.key], recoveryKeys: [recovery.key] };
  const release = buildRelease("1.2.3", new Map([["SKILL.md", Buffer.from("# yakfeed\n")]]));

  it("derives key ids from the key, and reads KMS's SubjectPublicKeyInfo", () => {
    expect(signer.keyId).toBe(keyIdFor(signer.key.publicKey));
    expect(signer.keyId).toMatch(/^yk-[0-9a-f]{16}$/);
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(signer.key.publicKey, "base64")]);
    expect(rawPublicKeyFromSpki(spki)).toBe(signer.key.publicKey);
  });

  it("accepts the same manifest again, and refuses another one at the same seq", async () => {
    const a = await signStatement(signer, manifestFor(release, { origin: keyset.origin, seq: 1, issuedAt: "2026-10-27T00:00:00.000Z" }));
    const first = verifySkill({ manifest: a.bytes, signature: a.signature, trust: trustFrom(keyset) });
    expect(first.trust.seq.skill).toBe(1);
    expect(first.trust.skillVersion).toBe("1.2.3");
    expect(() => verifySkill({ manifest: a.bytes, signature: a.signature, trust: first.trust })).not.toThrow();
    const b = await signStatement(signer, manifestFor(release, { origin: keyset.origin, seq: 1, issuedAt: "2026-10-27T01:00:00.000Z" }));
    expect(() => verifySkill({ manifest: b.bytes, signature: b.signature, trust: first.trust })).toThrow(expect.objectContaining({ reason: "seq_reused" }));
  });

  it("refuses statements over KMS's 4,096-byte limit, and a brief where a manifest was expected", async () => {
    const big = { ...manifestFor(release, { origin: keyset.origin, seq: 1, issuedAt: "2026-10-27T00:00:00.000Z" }), keyId: signer.keyId, name: "x".repeat(5000) };
    expect(() => statementBytes(big)).toThrow(SignatureError);
    const brief = await signStatement<BriefStatement>(signer, { type: STATEMENT_TYPES.brief, v: FORMAT_VERSION, origin: keyset.origin, seq: 1, issuedAt: "2026-10-27T00:00:00.000Z", version: 1, sha256: "0".repeat(64) });
    expect(() => verifySkill({ manifest: brief.bytes, signature: brief.signature, trust: trustFrom(keyset) })).toThrow(expect.objectContaining({ reason: "wrong_type" }));
  });

  it("refuses a rotation notice signed by a signing key, or replayed", async () => {
    const next = localSigner(seed("next"));
    const body = { type: STATEMENT_TYPES.rotation, v: FORMAT_VERSION, origin: keyset.origin, seq: 1, issuedAt: "2026-10-27T00:00:00.000Z", oldKeyId: signer.keyId, newKey: next.key, nextRecoveryKey: localSigner(seed("next recovery")).key, effectiveAt: "2026-11-01T00:00:00.000Z" } as const;
    const bySigning = await signStatement(signer, body);
    expect(() => applyRotation(trustFrom(keyset), { statement: bySigning.bytes.toString(), signature: bySigning.signature })).toThrow(expect.objectContaining({ reason: "unpinned_key" }));
    const ok = await signStatement(recovery, body);
    const rotated = applyRotation(trustFrom(keyset), { statement: ok.bytes.toString(), signature: ok.signature });
    expect(rotated.signingKeys.map((k) => k.id)).toEqual([signer.keyId, next.keyId]);
    expect(() => applyRotation(rotated, { statement: ok.bytes.toString(), signature: ok.signature })).toThrow(SignatureError);
  });

  it("refuses anything new from a retired key, however it's backdated, once the rotation has taken effect", async () => {
    const next = localSigner(seed("next"));
    const effectiveAt = new Date(Date.now() - 60_000).toISOString();
    const accepted = await signStatement(signer, manifestFor(release, { origin: keyset.origin, seq: 1, issuedAt: "2026-10-27T00:00:00.000Z" }));
    const before = verifySkill({ manifest: accepted.bytes, signature: accepted.signature, trust: trustFrom(keyset) }).trust;
    const notice = await signStatement<RotationNotice>(recovery, { type: STATEMENT_TYPES.rotation, v: FORMAT_VERSION, origin: keyset.origin, seq: 1, issuedAt: effectiveAt, oldKeyId: signer.keyId, newKey: next.key, nextRecoveryKey: localSigner(seed("next recovery")).key, effectiveAt });
    const rotated = applyRotation(before, { statement: notice.bytes.toString(), signature: notice.signature });
    // Seq 2, claiming to be issued a second before the rotation took effect.
    const backdated = await signStatement(signer, manifestFor(release, { origin: keyset.origin, seq: 2, issuedAt: new Date(Date.parse(effectiveAt) - 1000).toISOString() }));
    expect(() => verifySkill({ manifest: backdated.bytes, signature: backdated.signature, trust: rotated })).toThrow(expect.objectContaining({ reason: "expired_key" }));
    // What was accepted before still checks again, and the new key signs what's next.
    expect(() => verifySkill({ manifest: accepted.bytes, signature: accepted.signature, trust: rotated })).not.toThrow();
    const fresh = await signStatement(next, manifestFor(release, { origin: keyset.origin, seq: 2, issuedAt: new Date().toISOString() }));
    expect(() => verifySkill({ manifest: fresh.bytes, signature: fresh.signature, trust: rotated })).not.toThrow();
  });

  it("gives a production state saved before the ceremony the bundled recovery keys", () => {
    const bundled = trustFrom({ ...keyset, origin: PRODUCTION_ORIGIN, production: true });
    const early = trustFrom({ ...keyset, origin: PRODUCTION_ORIGIN, production: true, signingKeys: [], recoveryKeys: [] });
    const now = pinOnFirstUse(early, PRODUCTION_ORIGIN, null, bundled);
    expect(now.recoveryKeys).toEqual(keyset.recoveryKeys);
    expect(now.signingKeys).toEqual(keyset.signingKeys);
    // A recovery key a rotation named stays.
    const rotatedRecovery = localSigner(seed("next recovery")).key;
    expect(pinOnFirstUse({ ...early, recoveryKeys: [rotatedRecovery] }, PRODUCTION_ORIGIN, null, bundled).recoveryKeys).toEqual([rotatedRecovery]);
  });

  it("merges two processes' saves so neither loses a seq or a rotation", () => {
    const dir = mkdtempSync(join(tmpdir(), "trust-merge-"));
    const store = fileTrustStore(join(dir, "trust.json"));
    const start = trustFrom(keyset);
    store.save(start);
    // One process accepted skill 4; another, from the same earlier state, brief 7 and a rotation.
    store.save({ ...start, seq: { ...start.seq, skill: 4 }, accepted: { ...start.accepted, skill: "s4" }, skillVersion: "1.2.3" });
    store.save({ ...start, seq: { ...start.seq, brief: 7, rotation: 1 }, accepted: { ...start.accepted, brief: "b7" }, recoveryKeys: [], retired: { [signer.keyId]: "2026-11-01T00:00:00.000Z" } });
    expect(store.load(keyset.origin)).toMatchObject({ seq: { skill: 4, brief: 7, rotation: 1 }, accepted: { skill: "s4", brief: "b7" }, skillVersion: "1.2.3", recoveryKeys: [], retired: { [signer.keyId]: "2026-11-01T00:00:00.000Z" } });
    expect(readdirSync(dir)).toEqual(["trust.json"]);
  });

  it("pins production from the bundled keys only, and other origins on first use", () => {
    expect(PRODUCTION_KEYSET.origin).toBe(PRODUCTION_ORIGIN);
    expect(pinOnFirstUse(null, PRODUCTION_ORIGIN, { ...keyset, origin: PRODUCTION_ORIGIN }).signingKeys).toEqual(PRODUCTION_KEYSET.signingKeys);
    expect(pinOnFirstUse(null, "localhost:3000", keyset)).toMatchObject({ origin: "localhost:3000", production: false });
    expect(() => pinOnFirstUse(null, "localhost:3000", { ...keyset, production: true })).toThrow(SignatureError);
  });

  it("keeps the trust state in a private file", () => {
    const dir = mkdtempSync(join(tmpdir(), "trust-"));
    const store = fileTrustStore(join(dir, "yakfeed", "trust.json"));
    expect(store.load("x")).toBeNull();
    store.save(trustFrom(keyset));
    expect(store.load(keyset.origin)?.signingKeys).toEqual([signer.key]);
    expect(existsSync(join(dir, "yakfeed", "trust.json"))).toBe(true);
  });
});

describe("the skill's archive and manifest", () => {
  const source = new Map<string, Uint8Array>([
    ["references/errors.md", Buffer.from("# Errors\n")],
    ["SKILL.md", Buffer.from("# yakfeed\n")],
    ["references/api.md", Buffer.from("# API\n")],
  ]);

  it("builds the same bytes twice, whatever order the files come in", () => {
    const a = buildRelease("1.0.0", source);
    const b = buildRelease("1.0.0", new Map([...source].reverse()));
    expect(a.archive.bytes.equals(b.archive.bytes)).toBe(true);
    expect(a.archive.path).toBe("yakfeed-1.0.0.tar");
  });

  it("holds exactly the loose files, and the alias is SKILL.md's bytes", () => {
    const r = buildRelease("1.0.0", source);
    const inside = readArchive(r.archive.bytes, "yakfeed");
    expect(inside.map((e) => e.path)).toEqual(["SKILL.md", "references/api.md", "references/errors.md"]);
    for (const e of inside) expect(Buffer.from(e.bytes).equals(r.files.get(e.path)!)).toBe(true);
    expect(r.files.get("skill.md")!.equals(r.files.get("SKILL.md")!)).toBe(true);
  });

  it("refuses anything but SKILL.md and references/*.md", () => {
    expect(() => buildRelease("1.0.0", new Map([...source, ["setup.sh", Buffer.from("rm -rf /")]]))).toThrow(/Only SKILL.md/);
    expect(() => buildRelease("1.0", source)).toThrow(/MAJOR.MINOR.PATCH/);
    expect(() => buildArchive("yakfeed", [{ path: "../x", bytes: Buffer.from("") }])).toThrow();
  });

  it("orders versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});
