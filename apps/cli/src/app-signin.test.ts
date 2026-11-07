import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withLockFile } from "./app-signin.js";

describe("withLockFile", () => {
  it("removes its own lock, but leaves one another holder took after breaking it as stale", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "yak-lock-")), ".cli.lock");
    await withLockFile(path, async () => expect(existsSync(path)).toBe(true));
    expect(existsSync(path)).toBe(false);
    // A slow holder: meanwhile another yak broke its lock (stale) and took it.
    await withLockFile(path, async () => writeFileSync(path, "another holder's nonce"));
    expect(readFileSync(path, "utf8")).toBe("another holder's nonce");
  });
});
