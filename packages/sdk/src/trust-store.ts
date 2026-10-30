// Where an agent keeps what it pinned: one file, beside yak's config,
// with a trust state per origin. Saved after every accepted statement, or the next check can't
// tell a rollback from an update. `yak skill check` and the MCP server share it.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TrustState } from "./signing.js";

export interface TrustStore {
  load(origin: string): TrustState | null;
  save(state: TrustState): void;
}

export const defaultTrustPath = (env: NodeJS.ProcessEnv = process.env): string => join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "yakfeed", "trust.json");

/**
 * Two saves of the same origin's state, from processes that each loaded it earlier (`yak` and the
 * MCP server, say), merged so neither loses what the other accepted: each seq
 * keeps the higher value with its accepted statement, and the keys come from the state that applied
 * more rotation notices. A seq never goes back, so a rollback stays caught.
 */
export function mergeTrust(onDisk: TrustState, next: TrustState): TrustState {
  const keys = next.seq.rotation >= onDisk.seq.rotation ? next : onDisk;
  const skill = next.seq.skill >= onDisk.seq.skill ? next : onDisk;
  const brief = next.seq.brief >= onDisk.seq.brief ? next : onDisk;
  return {
    ...next,
    signingKeys: keys.signingKeys,
    recoveryKeys: keys.recoveryKeys,
    retired: { ...onDisk.retired, ...next.retired, ...keys.retired },
    seq: { skill: skill.seq.skill, brief: brief.seq.brief, rotation: keys.seq.rotation },
    accepted: { skill: skill.accepted.skill, brief: brief.accepted.brief },
    skillVersion: skill.skillVersion,
  };
}

/** How long a save waits for another process's save to finish, and when a lock left behind counts as stale: the store's own choices. */
const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;

/** Runs `write` holding `<path>.lock` (made with O_EXCL), so two processes' saves don't interleave. */
function withLock<T>(path: string, write: () => T): T {
  const lock = `${path}.lock`;
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx", 0o600));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A lock left by a process that died mid-save.
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { force: true });
      } catch {
        // Gone already: try again.
      }
      if (Date.now() > until) throw new Error(`${lock} is held by another yakfeed process. If none is running, remove it.`, { cause: error });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
    }
  }
  try {
    return write();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** A trust store in a JSON file (mode 600), written whole and renamed into place, one save at a time. */
export function fileTrustStore(path = defaultTrustPath()): TrustStore {
  const readAll = (): Record<string, TrustState> => {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, TrustState>;
    } catch {
      throw new Error(`${path} isn't valid JSON. Fix or remove it: it holds the keys you pinned.`);
    }
  };
  return {
    load: (origin) => readAll()[origin] ?? null,
    save: (state) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      withLock(path, () => {
        const all = readAll();
        const current = all[state.origin];
        const next = { ...all, [state.origin]: current ? mergeTrust(current, state) : state };
        const temp = `${path}.${process.pid}.tmp`;
        writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        renameSync(temp, path);
      });
    },
  };
}

/** A trust store in memory: tests, and agents that keep their state elsewhere. */
export function memoryTrustStore(initial: TrustState[] = []): TrustStore & { states: Map<string, TrustState> } {
  const states = new Map(initial.map((s) => [s.origin, s]));
  return { states, load: (origin) => states.get(origin) ?? null, save: (s) => void states.set(s.origin, s) };
}
