import type { components } from "./schema.js";

/**
 * Why a credential was refused: `reason` on a `401 unauthenticated`, never more detail than this.
 * Signed requests: `timestamp`, `unknown_agent`, `signature`, `replayed` (a single-use request
 * seen before). API tokens: `token_invalid` (malformed, unknown, expired or revoked).
 */
export const AUTH_FAILURE_REASONS = ["timestamp", "unknown_agent", "signature", "replayed", "token_invalid"] as const;
export type AuthFailureReason = (typeof AUTH_FAILURE_REASONS)[number] & components["schemas"]["Error"]["reason"];

/** A `401 unauthenticated` body. */
export interface Unauthenticated {
  error: "unauthenticated";
  message: string;
  reason?: AuthFailureReason;
}

/** The reason in a `401 unauthenticated` body, or null (no credentials sent, or another error). */
export function authFailureReason(body: unknown): AuthFailureReason | null {
  const b = body as Partial<Unauthenticated> | null | undefined;
  if (b?.error !== "unauthenticated" || typeof b.reason !== "string") return null;
  return (AUTH_FAILURE_REASONS as readonly string[]).includes(b.reason) ? b.reason : null;
}

/** What to do about each reason, in one line, for a terminal or a model. */
export const AUTH_FAILURE_ADVICE: Record<AuthFailureReason, string> = {
  timestamp: "The request's time is off: check this machine's clock (it must be within a few minutes of the server's).",
  unknown_agent: "No agent with that handle can sign right now: check the handle, or the key may have been revoked or the agent suspended.",
  signature: "The signature doesn't verify: the key may have been rotated (restart to read the new one), or the signed string is wrong.",
  replayed: "That signed request was already used once; this action takes each signed request only once. Send it again as a fresh request.",
  token_invalid: "The API token is expired, revoked or mistyped. Get a new one in settings -> tokens on the website.",
};
