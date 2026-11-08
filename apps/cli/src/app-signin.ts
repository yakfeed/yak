// Where `yak login` keeps an app's sign-in: the access token (an hour) and its expiry in the config
// file, the refresh token in the system's keychain where there is one (macOS Keychain, the Secret
// Service on Linux through `secret-tool`), else in the config file too (mode 600), never synced.
// `yak` and the MCP server each have their own sign-in, so they never use one refresh token twice.
// A refresh holds a lock file next to the config, so two commands at once don't both refresh.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, rmSync, statSync, writeFileSync, type Stats } from "node:fs";
import type { AppSignIn, SignInStore } from "@yakfeed/sdk";
import type { ConfigStore } from "./config.js";

/** Which of yakfeed's apps a sign-in is for: `yak` itself, or the MCP server. */
export type AppKind = "cli" | "mcp";

/** A sign-in as the config file keeps it. */
export interface SavedAppSignIn {
  /** The API it signed in to: it's never sent to another. */
  apiUrl: string;
  accessToken: string;
  accessExpiresAt: string;
  scope: string;
  /** Where the refresh token is: the system's keychain, or `refreshToken` here. */
  refreshIn: "keychain" | "file";
  refreshToken?: string;
}

/** A place for secrets outside the config file. */
export interface Keychain {
  readonly name: string;
  get(account: string): string | null;
  set(account: string, secret: string): boolean;
  delete(account: string): void;
}

const SERVICE = "yakfeed";

const run = (command: string, args: string[], input?: string) => spawnSync(command, args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });

/** macOS: the login keychain, through `security`. The secret goes on stdin (`security -i`), never in a command line. */
function macKeychain(): Keychain {
  return {
    name: "the macOS keychain",
    get(account) {
      const r = run("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
      return r.status === 0 ? r.stdout.trim() || null : null;
    },
    set(account, secret) {
      const r = run("security", ["-i"], `add-generic-password -U -s ${SERVICE} -a ${account} -w ${secret}\n`);
      return r.status === 0;
    },
    delete(account) {
      run("security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
    },
  };
}

/** Linux: the Secret Service (GNOME Keyring, KWallet), through `secret-tool`; the secret on stdin. */
function secretService(): Keychain {
  return {
    name: "the Secret Service keyring",
    get(account) {
      const r = run("secret-tool", ["lookup", "service", SERVICE, "account", account]);
      return r.status === 0 ? r.stdout.trim() || null : null;
    },
    set(account, secret) {
      return run("secret-tool", ["store", "--label", `yakfeed (${account})`, "service", SERVICE, "account", account], secret).status === 0;
    },
    delete(account) {
      run("secret-tool", ["clear", "service", SERVICE, "account", account]);
    },
  };
}

/** The system's keychain, when there's one to use here; null otherwise (SSH sessions, containers). YAK_KEYCHAIN=off turns it off. */
export function systemKeychain(env: Record<string, string | undefined> = process.env, platform = process.platform): Keychain | null {
  if (env.YAK_KEYCHAIN === "off") return null;
  if (platform === "darwin" && run("security", ["help"]).error === undefined) return macKeychain();
  if (platform === "linux" && env.DBUS_SESSION_BUS_ADDRESS && run("secret-tool", ["--version"]).error === undefined) return secretService();
  return null;
}

/** A keychain in memory, for tests. */
export function memoryKeychain(): Keychain & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    name: "a test keychain",
    entries,
    get: (a) => entries.get(a) ?? null,
    set: (a, s) => (entries.set(a, s), true),
    delete: (a) => void entries.delete(a),
  };
}

/** The keychain entry's name: the app and the API, so a staging sign-in never meets production's. */
export function keychainAccount(kind: AppKind, apiUrl: string): string {
  return `${kind}@${new URL(apiUrl).host}`;
}

/** Unit conversions and lock tuning, yak's own: not API values. */
const LOCK_WAIT_STEP_MS = 50;
/** A lock older than this was left by a process that died mid-refresh. */
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MAX_MS = 15_000;

/**
 * Holds `path` as a lock file while `fn` runs; waits for another holder, and breaks a stale lock.
 * The file holds this holder's nonce, and is removed only while it still does: a holder that ran
 * past LOCK_STALE_MS, whose lock another broke and took, leaves the new holder's lock alone.
 */
export async function withLockFile<T>(path: string, fn: () => Promise<T>, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  const nonce = randomUUID();
  for (let waited = 0; ; waited += LOCK_WAIT_STEP_MS) {
    try {
      const fd = openSync(path, "wx", 0o600);
      try {
        // writeFileSync on a descriptor writes it all, where one writeSync may write part.
        writeFileSync(fd, nonce);
        closeSync(fd);
      } catch (error) {
        // A full disk, say: the empty or partial lock would hold every other refresh up until it went stale.
        try {
          closeSync(fd);
        } catch {
          // Already closed, or the close is what failed.
        }
        rmSync(path, { force: true });
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const seen = statSync(path, { throwIfNoEntry: false });
      // Broken: take it at once. Otherwise (fresh, or another waiter is breaking it) wait a step.
      if (seen && isStale(seen) && breakStaleLock(path)) continue;
      if (waited >= LOCK_WAIT_MAX_MS) throw new Error(`Another yak is refreshing the sign-in (${path}). If none is running, delete that file (and ${path}.break, if it is there) and try again.`, { cause: error });
      else await sleep(LOCK_WAIT_STEP_MS);
    }
  }
  try {
    return await fn();
  } finally {
    if (ownsLock(path, nonce)) rmSync(path, { force: true });
  }
}

const isStale = (lock: Stats) => Date.now() - lock.mtimeMs > LOCK_STALE_MS;

/**
 * Breaks a stale lock under a second lock, `<path>.break`, which one waiter holds at a time: it
 * looks at the lock again and removes it only if it's still stale. Two waiters can both judge one
 * lock stale; the second, once the first is done, finds the first's new lock fresh and leaves it,
 * so a lock younger than LOCK_STALE_MS is never removed. A breaker that died holding `.break`
 * leaves one that goes stale too, and is removed the same way. True when it removed the lock.
 * Exported for tests.
 */
export function breakStaleLock(path: string): boolean {
  const breaking = `${path}.break`;
  try {
    closeSync(openSync(breaking, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const left = statSync(breaking, { throwIfNoEntry: false });
    if (left && isStale(left)) rmSync(breaking, { force: true });
    return false; // Another waiter is breaking it; wait for the lock as usual.
  }
  try {
    const seen = statSync(path, { throwIfNoEntry: false });
    if (!seen || !isStale(seen)) return false;
    rmSync(path, { force: true });
    return true;
  } finally {
    rmSync(breaking, { force: true });
  }
}

function ownsLock(path: string, nonce: string): boolean {
  try {
    return readFileSync(path, "utf8") === nonce;
  } catch {
    return false;
  }
}

/** Saves a new sign-in: the refresh token to the keychain if there's one, else to the file. Returns where it went. */
export function saveAppSignIn(store: ConfigStore, keychain: Keychain | null, kind: AppKind, apiUrl: string, signIn: AppSignIn): "keychain" | "file" {
  const inKeychain = keychain?.set(keychainAccount(kind, apiUrl), signIn.refreshToken) ?? false;
  const saved: SavedAppSignIn = {
    apiUrl,
    accessToken: signIn.accessToken,
    accessExpiresAt: signIn.accessExpiresAt,
    scope: signIn.scope,
    refreshIn: inKeychain ? "keychain" : "file",
    ...(inKeychain ? {} : { refreshToken: signIn.refreshToken }),
  };
  const config = store.load();
  store.save({ ...config, appSignIns: { ...config.appSignIns, [kind]: saved } });
  return saved.refreshIn;
}

/** Forgets a sign-in here: the config entry and its keychain item. */
export function forgetAppSignIn(store: ConfigStore, keychain: Keychain | null, kind: AppKind): SavedAppSignIn | null {
  const config = store.load();
  const saved = config.appSignIns?.[kind] ?? null;
  if (!saved) return null;
  if (saved.refreshIn === "keychain") keychain?.delete(keychainAccount(kind, saved.apiUrl));
  const { [kind]: _gone, ...rest } = config.appSignIns ?? {};
  store.save({ ...config, appSignIns: rest });
  return saved;
}

/** The refresh token of a saved sign-in, wherever it is; null when it's gone (the keychain item deleted). */
export function refreshTokenOf(saved: SavedAppSignIn, keychain: Keychain | null, kind: AppKind): string | null {
  return saved.refreshIn === "file" ? (saved.refreshToken ?? null) : (keychain?.get(keychainAccount(kind, saved.apiUrl)) ?? null);
}

/** The SDK's SignInStore over the config file and the keychain: every read is fresh from disk. */
export function appSignInStore(store: ConfigStore, keychain: Keychain | null, kind: AppKind): SignInStore {
  return {
    async read() {
      const config = store.load();
      const saved = config.appSignIns?.[kind];
      if (!saved || !sameOrigin(saved.apiUrl, config.apiUrl)) return null;
      const refreshToken = refreshTokenOf(saved, keychain, kind);
      return refreshToken ? { accessToken: saved.accessToken, accessExpiresAt: saved.accessExpiresAt, refreshToken, scope: saved.scope } : null;
    },
    async write(signIn) {
      const config = store.load();
      if (!signIn) {
        forgetAppSignIn(store, keychain, kind);
        return;
      }
      saveAppSignIn(store, config.appSignIns?.[kind]?.refreshIn === "file" ? null : keychain, kind, config.appSignIns?.[kind]?.apiUrl ?? config.apiUrl, signIn);
    },
    // A store in memory (tests) has no file to lock next to: one process, one queue.
    withLock: store.path.startsWith("(") ? inProcessLock() : (fn) => withLockFile(`${store.path}.${kind}.lock`, fn),
  };
}

function inProcessLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };
}

const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
};
