// How yak fails: one shape for every error, so `--json` can print it on stdout and a script
// can branch on the exit code instead of reading the words.

/** yak's exit codes. Stable: scripts branch on them. */
export const EXIT = {
  ok: 0,
  /** Anything else: the network, a server error, or yak's own failure. */
  failed: 1,
  /** The command or its arguments were wrong. */
  usage: 2,
  /** Not signed in, or the credential was refused (401). */
  auth: 3,
  /** Not allowed (403): the token's scopes, a policy version to agree to, a feature switched off, a ban. */
  refused: 4,
  /** Not found (404). */
  notFound: 5,
  /** The API refused the request as invalid or in conflict (400, 409, 422). */
  invalid: 6,
  /** Too many requests, the API briefly unavailable, or a first try with the same key still running: wait `retryAfter` seconds, then try again (429, 503, 409 idempotency_key_in_use). */
  wait: 7,
} as const;

/** The exit codes as help text: one line each. */
export const EXIT_HELP = `Exit codes: 0 ok · 1 failed (network, server, other) · 2 usage · 3 not signed in or credential refused (401) ·
  4 not allowed (403) · 5 not found (404) · 6 invalid or conflict (400, 409, 422) · 7 wait retryAfter seconds, then retry (429, 503, a key still in use)`;

/** An error as yak reports it: the API's error id and words, or yak's own. */
export interface Failure {
  /** The API's `error` (e.g. `rate_limited`), or yak's own: `usage`, `network`, `failed`. */
  error: string;
  message: string;
  /** The HTTP status, when the API answered. */
  status: number | null;
  /** Seconds to wait before trying again, when the API said. */
  retryAfter: number | null;
  /** The Idempotency-Key yak sent with the last write, so running the command again with it is safe. */
  idempotencyKey?: string;
  /** The earlier post, for `duplicate_link`: join that thread instead. */
  post?: unknown;
}

/**
 * Failures that mean "the same thing, a little later": a key still in use by a first try that
 * hasn't finished (the API's Retry-After says how long), and yak's own wait that ran out first.
 */
const WAIT_ERRORS = new Set(["idempotency_key_in_use", "still_running"]);

/** A refusal from the API, with its error id, status and wait, in yak's words. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

/** A command or argument yak can't use. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Seconds to wait, from the error body's `retryAfter` or the `Retry-After` header. */
export function retryAfterOf(body: unknown, response?: Response): number | null {
  const fromBody = (body as { retryAfter?: unknown } | undefined)?.retryAfter;
  if (typeof fromBody === "number" && fromBody >= 0) return fromBody;
  const header = Number(response?.headers.get("retry-after"));
  return Number.isFinite(header) && header > 0 ? header : null;
}

/** Any error, as a Failure. The SDK's own errors (approvals, registration, connect) carry `code` and `status`. */
export function failureOf(error: unknown): Failure {
  if (error instanceof ApiFailure) return { error: error.code, message: error.message, status: error.status, retryAfter: error.retryAfter };
  if (error instanceof UsageError) return { error: "usage", message: error.message, status: null, retryAfter: null };
  const e = error as { message?: unknown; code?: unknown; status?: unknown; retryAfter?: unknown; body?: { retryAfter?: unknown }; name?: unknown };
  const message = typeof e?.message === "string" ? e.message : String(error);
  // node:util's parseArgs: an unknown option, a missing value.
  if (typeof e?.code === "string" && e.code.startsWith("ERR_PARSE_ARGS")) return { error: "usage", message, status: null, retryAfter: null };
  if (typeof e?.code === "string" && typeof e.status === "number") {
    return { error: e.code, message, status: e.status, retryAfter: retryAfterOf(typeof e.retryAfter === "number" ? e : e.body) };
  }
  if (/^Usage:/.test(message)) return { error: "usage", message, status: null, retryAfter: null };
  if (e?.name === "TimeoutError" || (error instanceof TypeError && /fetch failed/i.test(message))) return { error: "network", message, status: null, retryAfter: null };
  return { error: "failed", message, status: null, retryAfter: null };
}

/** The exit code for a failure. */
export function exitCodeOf(f: Failure): number {
  if (f.error === "usage") return EXIT.usage;
  if (WAIT_ERRORS.has(f.error)) return EXIT.wait;
  switch (f.status) {
    case 401:
      return EXIT.auth;
    case 403:
      return EXIT.refused;
    case 404:
      return EXIT.notFound;
    case 400:
    case 409:
    case 422:
      return EXIT.invalid;
    case 429:
      return EXIT.wait;
    case 503:
      return f.retryAfter !== null ? EXIT.wait : EXIT.failed;
    default:
      return EXIT.failed;
  }
}

/** Whether a write's outcome is unknown, so running it again with the same key is the safe retry. */
export function outcomeUnknown(f: Failure): boolean {
  return f.error === "network" || (f.status !== null && f.status >= 500);
}
