// Idempotent writes: the client sends an Idempotency-Key on every operation
// that takes one, a fresh UUID per call unless the caller gave its own, and retries such a call
// once, with the same key, when the answer never came (a network error, 502, 503 or 504) or the
// first try is still running (409 idempotency_key_in_use). The API answers a repeat with the
// first success, marked `Idempotent-Replayed: true`, so the retry can't write twice.
import { IDEMPOTENT_OPERATIONS } from "./idempotent-operations.js";

const TEMPLATES = IDEMPOTENT_OPERATIONS.map((op) => {
  const [method, path] = op.split(" ") as [string, string];
  return { method, pattern: new RegExp(`^${path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`) };
});

/** Whether the API takes an Idempotency-Key on this method and path (e.g. "/v1/posts/abc/vote"). */
export function takesIdempotencyKey(method: string, path: string): boolean {
  const m = method.toUpperCase();
  return TEMPLATES.some((t) => t.method === m && t.pattern.test(path));
}

/** How long to wait before the one retry, in milliseconds (a 409's Retry-After, else half a second). */
const RETRY_DELAY_MS = 500;

export interface IdempotentFetchOptions {
  /** The client's base URL: its path is stripped before matching operations (for an API under a prefix). */
  baseUrl?: string;
  /** For tests: how to wait. */
  sleep?: (ms: number) => Promise<void>;
  /** For tests: how to make a key. */
  newKey?: () => string;
}

/** A fetch that adds an Idempotency-Key where the API takes one, and retries such a call once. */
export function idempotentFetch(base: (input: Request) => Promise<Response>, options: IdempotentFetchOptions = {}): (input: Request) => Promise<Response> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const newKey = options.newKey ?? (() => globalThis.crypto.randomUUID());
  const prefix = basePath(options.baseUrl);
  return async (request: Request) => {
    const url = new URL(request.url);
    const path = prefix && url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
    if (!takesIdempotencyKey(request.method, path)) return base(request);
    const headers = new Headers(request.headers);
    if (!headers.has("idempotency-key")) headers.set("idempotency-key", newKey());
    const first = new Request(request, { headers });
    // Kept before the first try reads the body.
    const second = first.clone();
    let response: Response;
    try {
      response = await base(first);
    } catch (error) {
      // A deadline or the caller's abort is final; a dropped connection is worth one more try.
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw error;
      await sleep(RETRY_DELAY_MS);
      return base(second);
    }
    if ([502, 503, 504].includes(response.status)) {
      await sleep(RETRY_DELAY_MS);
      return base(second);
    }
    if (response.status === 409 && (await isKeyInUse(response))) {
      const wait = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(wait) && wait > 0 ? wait * 1000 : RETRY_DELAY_MS);
      return base(second);
    }
    return response;
  };
}

async function isKeyInUse(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    return body.error === "idempotency_key_in_use";
  } catch {
    return false;
  }
}

function basePath(baseUrl: string | undefined): string {
  try {
    return baseUrl ? new URL(baseUrl).pathname.replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}
