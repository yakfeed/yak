import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { breakStaleLock, withLockFile } from "./app-signin.js";

describe("withLockFile", () => {
  it("removes its own lock, but leaves one another holder took after breaking it as stale", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "yak-lock-")), ".cli.lock");
    await withLockFile(path, async () => expect(existsSync(path)).toBe(true));
    expect(existsSync(path)).toBe(false);
    // A slow holder: meanwhile another yak broke its lock (stale) and took it.
    await withLockFile(path, async () => writeFileSync(path, "another holder's nonce"));
    expect(readFileSync(path, "utf8")).toBe("another holder's nonce");
  });

  it("breaks a stale lock once: a second breaker finds the first's new lock fresh and leaves it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "yak-lock-")), ".cli.lock");
    writeFileSync(path, "a holder that died");
    const old = new Date(Date.now() - 60_000);
    utimesSync(path, old, old);
    // Two waiters judged that lock stale. The first broke it and took a new one...
    breakStaleLock(path);
    expect(existsSync(path)).toBe(false);
    writeFileSync(path, "the first waiter's nonce");
    // ...and the second, acting on what it saw, looks again and leaves it.
    breakStaleLock(path);
    expect(readFileSync(path, "utf8")).toBe("the first waiter's nonce");
    expect(readdirSync(dirname(path))).toEqual([".cli.lock"]);
  });

  it("waits a step, rather than spinning, while another waiter holds the break lock", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "yak-lock-")), ".cli.lock");
    const old = new Date(Date.now() - 60_000);
    writeFileSync(path, "a holder that died");
    utimesSync(path, old, old);
    writeFileSync(`${path}.break`, "");
    let sleeps = 0;
    // The other breaker finishes during our second wait.
    const sleep = async () => {
      if (++sleeps === 2) rmSync(`${path}.break`);
    };
    expect(await withLockFile(path, async () => "held", sleep)).toBe("held");
    expect(sleeps).toBe(2);
  });

  it("leaves the lock alone while another waiter is breaking it, and clears a break lock its breaker died holding", () => {
    const path = join(mkdtempSync(join(tmpdir(), "yak-lock-")), ".cli.lock");
    const old = new Date(Date.now() - 60_000);
    writeFileSync(path, "a holder that died");
    utimesSync(path, old, old);
    writeFileSync(`${path}.break`, "");
    breakStaleLock(path);
    expect(existsSync(path)).toBe(true);
    // That breaker died too: its break lock goes stale, and is cleared for the next try.
    utimesSync(`${path}.break`, old, old);
    breakStaleLock(path);
    expect(existsSync(`${path}.break`)).toBe(false);
    breakStaleLock(path);
    expect(readdirSync(dirname(path))).toEqual([]);
  });
});
