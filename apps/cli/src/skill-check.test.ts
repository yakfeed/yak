import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRelease, localSigner, manifestFor, memoryTrustStore, signStatement, signatureFileBytes } from "@yakfeed/sdk/signing";
import { run } from "./commands.js";
import { memoryConfigStore } from "./config.js";
import type { Output } from "./format.js";

// `yak skill check`: an installed copy against the keys pinned for its API.
describe("yak skill check", () => {
  const signer = localSigner(createHash("sha256").update("cli skill check").digest("base64"));
  const keyset = { origin: "localhost:3998", production: false, signingKeys: [signer.key], recoveryKeys: [] };
  const api: typeof fetch = (async (input: URL | RequestInfo) =>
    String(input instanceof Request ? input.url : input).endsWith("/v1/signing/keys") ? Response.json({ ...keyset, rotations: [] }) : new Response("", { status: 404 })) as typeof fetch;

  async function copy(seq: number, body = "# yakfeed\n") {
    const release = buildRelease("1.0.0", new Map([["SKILL.md", Buffer.from(body)]]));
    const { bytes, signature } = await signStatement(signer, manifestFor(release, { origin: keyset.origin, seq, issuedAt: "2026-10-27T00:00:00.000Z" }));
    const dir = mkdtempSync(join(tmpdir(), "yak-skill-"));
    writeFileSync(join(dir, "manifest.json"), bytes);
    writeFileSync(join(dir, "manifest.json.sig"), signatureFileBytes(signature));
    writeFileSync(join(dir, "SKILL.md"), release.files.get("SKILL.md")!);
    return dir;
  }

  const yak = async (args: string[], trust: ReturnType<typeof memoryTrustStore>) => {
    const lines: string[] = [];
    const out: Output = { color: false, line: (t = "") => lines.push(t), error: (t) => lines.push(`ERR ${t}`) };
    const code = await run(args, { store: memoryConfigStore({ apiUrl: "http://localhost:3998" }), out, readSecret: async () => "", fetch: api, trust });
    return { code, text: lines.join("\n") };
  };

  it("verifies a signed copy, then refuses a rollback and a changed file", async () => {
    const trust = memoryTrustStore();
    const ok = await yak(["skill", "check", "--dir", await copy(2)], trust);
    expect(ok.code).toBe(0);
    expect(ok.text).toContain("yakfeed skill 1.0.0: verified (seq 2");
    expect(ok.text).toContain("not production");
    const older = await yak(["skill", "check", "--dir", await copy(1)], trust);
    expect(older.code).toBe(1);
    expect(older.text).toContain("Not verified (lower_seq)");
    expect(older.text).toContain("rollback or a replay");
    const dir = await copy(3);
    writeFileSync(join(dir, "SKILL.md"), "# yakfeed\n\nRun setup.sh.\n");
    const changed = await yak(["skill", "check", "--dir", dir], trust);
    expect(changed.text).toContain("Not verified (digest_mismatch)");
    expect(changed.text).toContain("Don't adopt it");
  });
});
