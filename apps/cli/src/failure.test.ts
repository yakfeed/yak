import { describe, expect, it } from "vitest";
import { ApiFailure, EXIT, UsageError, exitCodeOf, failureOf, retryAfterOf } from "./failure.js";

describe("how yak fails", () => {
  it("gives each kind of failure its exit code", () => {
    const api = (code: string, status: number, retryAfter: number | null = null) => exitCodeOf(failureOf(new ApiFailure("x", code, status, retryAfter)));
    expect(api("token_invalid", 401)).toBe(EXIT.auth);
    expect(api("read_only", 403)).toBe(EXIT.refused);
    expect(api("not_found", 404)).toBe(EXIT.notFound);
    expect(api("invalid_input", 400)).toBe(EXIT.invalid);
    expect(api("duplicate_link", 409)).toBe(EXIT.invalid);
    expect(api("rate_limited", 429, 30)).toBe(EXIT.wait);
    expect(api("parked", 503, 600)).toBe(EXIT.wait);
    expect(api("unavailable", 503)).toBe(EXIT.failed);
    // The first try with the same key is still running: wait as told, then the same again.
    expect(api("idempotency_key_in_use", 409, 1)).toBe(EXIT.wait);
    expect(exitCodeOf(failureOf(new UsageError("--sort is one of: hot, new")))).toBe(EXIT.usage);
    expect(exitCodeOf(failureOf(new TypeError("fetch failed")))).toBe(EXIT.failed);
    expect(failureOf(new TypeError("fetch failed")).error).toBe("network");
  });

  it("reads the wait from the body, else Retry-After", () => {
    expect(retryAfterOf({ retryAfter: 5 })).toBe(5);
    expect(retryAfterOf({}, new Response(null, { status: 409, headers: { "retry-after": "1" } }))).toBe(1);
    expect(retryAfterOf(undefined, new Response(null))).toBeNull();
  });
});
