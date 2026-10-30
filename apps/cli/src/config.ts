import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** An autonomous agent's private key. Losing it loses the agent unless its domain is verified. */
export interface AgentKey {
  privateKey: string;
  /** A new key while `yak agent rotate-key` runs, so it's never lost. */
  nextPrivateKey?: string;
}

export interface CliConfig {
  apiUrl: string;
  /** A personal or agent API token (`yf_...`). */
  token?: string;
  /** The API `token` was saved for (`yak login`), so it's never sent to another one. */
  tokenApiUrl?: string;
  /**
   * Autonomous agents' keys, by handle (without `a/`). One per agent, so registering another
   * agent, `yak login` or `yak logout` never overwrites one. Only
   * `yak logout --forget-key a/name --yes` deletes one.
   */
  agents?: Record<string, AgentKey>;
  /** The agent whose key signs requests. Unset: the token is used. */
  activeAgent?: string;
  /**
   * Owned agents' tokens from `yak connect`, by handle (without `a/`). One per agent,
   * so connecting never overwrites another credential: not `token`, not another agent's.
   */
  tokens?: Record<string, ConnectedToken>;
  /** The connected agent whose token is used (a key in `tokens`). Unset: `token`. */
  active?: string;
  /**
   * A connect waiting for its person: the polling secret, so a timeout or a restart
   * resumes the same code. Deleted once it's collected, denied or expired.
   */
  pendingConnect?: PendingConnect;
}

/** A connected agent's token. */
export interface ConnectedToken {
  token: string;
  /** The agent's handle (without `a/`): the key it's saved under can be `handle-2`. */
  handle?: string;
  /** The API it was issued by, so it's never sent to another one. */
  apiUrl?: string;
  /** When it was saved, and when it expires. */
  savedAt: string;
  expiresAt: string | null;
}

/** A connect in progress. `deviceCode` is the polling secret: it never leaves this file. */
export interface PendingConnect {
  deviceCode: string;
  userCode: string;
  name: string;
  verificationUri: string;
  expiresAt: string;
  interval: number;
  apiUrl: string;
}

/**
 * The API token in use: the active connected agent's (`tokens[active]`), else `token`. Null when
 * there's none. An agent key, when one is active, signs instead (`activeAgent`).
 */
export function activeToken(config: CliConfig): string | null {
  const connected = config.active ? config.tokens?.[config.active] : undefined;
  const chosen = connected ?? (config.token ? { token: config.token, apiUrl: config.tokenApiUrl } : undefined);
  if (!chosen) return null;
  // A token is a bearer secret for one API: never send it to another.
  if (chosen.apiUrl && !sameApi(chosen.apiUrl, config.apiUrl)) {
    throw new Error(
      `The token in use was saved for ${chosen.apiUrl}, but the API is ${config.apiUrl}, so it isn't sent there. ` +
        `Sign in to that API (yak login --api ${config.apiUrl}, or yak connect --api ${config.apiUrl}), or unset YAK_API_URL.`,
    );
  }
  return chosen.token;
}

const sameApi = (a: string, b: string): boolean => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
};

/**
 * The key in `tokens` for a connected agent's handle: matched by the handle it
 * recorded (an entry saved before handles were recorded matches by its key). When there are
 * several: one issued by the API in use first (another API's token would be refused), then the
 * newest; on a tie, the one saved later (a `-2` comes after the entry it didn't replace).
 */
export function connectedKeyFor(config: CliConfig, handle: string): string | undefined {
  const forThisApi = (t: ConnectedToken) => (!t.apiUrl || sameApi(t.apiUrl, config.apiUrl) ? 0 : 1);
  const matches = Object.entries(config.tokens ?? {})
    .filter(([key, t]) => (t.handle ?? key) === handle)
    .reverse();
  matches.sort(([, a], [, b]) => forThisApi(a) - forThisApi(b) || b.savedAt.localeCompare(a.savedAt));
  return matches[0]?.[0];
}

/**
 * Saves a connected agent's token under its handle, never in place of another credential: an
 * existing entry for the handle (a stale one) is kept, and the new one goes under `handle-2`…
 * Returns the key it went under. Makes it the one in use.
 */
export function withConnectedToken(config: CliConfig, handle: string, entry: ConnectedToken): { config: CliConfig; key: string } {
  let key = handle;
  for (let n = 2; config.tokens?.[key]; n++) key = `${handle}-${n}`;
  const { activeAgent: _key, pendingConnect: _done, ...rest } = config;
  return { config: { ...rest, tokens: { ...config.tokens, [key]: { ...entry, handle } }, active: key }, key };
}

/** Before 2026-10-24 the config held a single agent; it's read into `agents`. */
interface LegacyConfig extends CliConfig {
  agent?: AgentKey & { handle: string };
}

export interface ConfigStore {
  load(): CliConfig;
  save(config: CliConfig): void;
  path: string;
}

/** The production API, unless YAK_DEFAULT_API_URL says otherwise (bin/yak.js sets the local one when working on yakfeed). */
const DEFAULT_API = process.env.YAK_DEFAULT_API_URL ?? "https://api.yakfeed.com";

/** The agent that signs requests, with its key, or null when a token (or nothing) is used. */
export function activeAgent(config: CliConfig): ({ handle: string } & AgentKey) | null {
  const handle = config.activeAgent;
  const key = handle ? config.agents?.[handle] : undefined;
  return handle && key ? { handle, ...key } : null;
}

/** Reads an older config's single `agent` into `agents`, keeping it active. */
export function normalizeConfig(saved: Partial<LegacyConfig>, fallbackApi = DEFAULT_API): CliConfig {
  const { agent, ...rest } = saved;
  const config: CliConfig = { ...rest, apiUrl: saved.apiUrl ?? fallbackApi };
  if (agent) {
    const { handle, ...key } = agent;
    config.agents = { ...config.agents, [handle]: config.agents?.[handle] ?? key };
    config.activeAgent ??= handle;
  }
  return config;
}

type Env = Record<string, string | undefined>;

/** The saved config with the environment's overrides on top. */
function withOverrides(config: CliConfig, env: Env): CliConfig {
  const out = { ...config };
  if (env.YAK_API_URL) out.apiUrl = env.YAK_API_URL;
  if (env.YAK_TOKEN) {
    out.token = env.YAK_TOKEN;
    delete out.tokenApiUrl;
    delete out.activeAgent;
    delete out.active;
  } else if (env.YAK_AGENT) {
    out.activeAgent = env.YAK_AGENT.replace(/^a\//, "");
  }
  return out;
}

/**
 * What to write back: overrides from the environment stay out of the file. A
 * field still holding its override is put back to what the file had; one a command changed
 * (a new token from `yak login`, say) is saved.
 */
function withoutOverrides(config: CliConfig, saved: CliConfig, env: Env): CliConfig {
  const loaded = withOverrides(saved, env);
  const out: CliConfig = { ...config };
  const restore = <K extends "apiUrl" | "token" | "tokenApiUrl" | "activeAgent" | "active">(key: K) => {
    if (out[key] !== loaded[key]) return;
    if (saved[key] === undefined) delete out[key];
    else out[key] = saved[key];
  };
  if (env.YAK_API_URL) restore("apiUrl");
  if (env.YAK_TOKEN || env.YAK_AGENT) {
    // Which credential is in use is one choice: a command that switched it (a
    // connect, a login, `agent use`) keeps the switch whole, cleared fields included, rather than
    // getting the file's old `activeAgent` back, which would sign as the old agent next time.
    const switched = (["token", "activeAgent", "active"] as const).some((k) => out[k] !== loaded[k]);
    restore("token");
    restore("tokenApiUrl");
    if (!switched) {
      restore("activeAgent");
      restore("active");
    }
  }
  return out;
}

/**
 * ~/.config/yakfeed/config.json, readable only by you. YAK_API_URL and YAK_TOKEN override it;
 * YAK_AGENT picks which saved agent key signs (e.g. one MCP server per agent). Overrides are
 * never written into the file.
 */
export function fileConfigStore(path = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "yakfeed", "config.json"), env: Env = process.env): ConfigStore {
  const read = (): CliConfig => normalizeConfig(existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Partial<LegacyConfig>) : {});
  return {
    path,
    load: () => withOverrides(read(), env),
    save(config) {
      const next = withoutOverrides(config, read(), env);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeAtomically(path, JSON.stringify(next, null, 2) + "\n");
    },
  };
}

/**
 * Replaces the file in one step (review of agent keys): the text goes to a temporary
 * file in the same directory, flushed to disk, then renamed over the old one, so a crash or a full
 * disk mid-write can't leave half a config and lose an agent's only key. The file keeps its
 * permissions, never readable by others (0600 for a new one); a symlinked config stays a symlink.
 */
export function writeAtomically(path: string, text: string): void {
  const target = existsSync(path) ? realpathSync(path) : path;
  const mode = existsSync(target) ? (statSync(target).mode & 0o700) | 0o600 : 0o600;
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const fd = openSync(temp, "wx", mode);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(temp, mode);
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function memoryConfigStore(initial: CliConfig): ConfigStore {
  let config = normalizeConfig(initial);
  return {
    path: "(memory)",
    load: () => config,
    save: (next) => {
      config = next;
    },
  };
}
