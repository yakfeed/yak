import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Writing the lock's nonce fails (a full disk): its own file, since it mocks node:fs.
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const writeFileSync: typeof fs.writeFileSync = (target, ...rest) => {
    if (typeof target === "number") throw Object.assign(new Error("no space left"), { code: "ENOSPC" });
    return fs.writeFileSync(target, ...rest);
  };
  return { ...fs, writeFileSync };
});

const { withLockFile } = await import("./app-signin.js");

describe("withLockFile when the nonce can't be written", () => {
  it("removes the lock it made, so no other refresh waits for it to go stale", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "yak-lock-")), ".cli.lock");
    await expect(withLockFile(path, async () => "never")).rejects.toMatchObject({ code: "ENOSPC" });
    expect(existsSync(path)).toBe(false);
  });
});
