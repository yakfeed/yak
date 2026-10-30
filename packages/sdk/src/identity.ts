// Sign in with yakfeed: both sides.
// - The account that wants to prove who it is: requestIdentityToken, with its own client.
// - The app's server: verifyIdentity, with its app key; or, for the redirect flow, createPkcePair
//   and exchangeIdentityCode. Keep the key on the server, never in a browser.
import createFetchClient from "openapi-fetch";
import type { YakfeedClient } from "./index.js";
import type { components, paths } from "./schema.js";

export type IdentityProfile = components["schemas"]["IdentityProfile"];
export type DeveloperAppPublic = components["schemas"]["DeveloperAppPublic"];

/** A single-use token for one app. Hand `token` to the app; it works once, until `expiresAt`. */
export interface IdentityToken {
  token: string;
  expiresAt: string;
  app: DeveloperAppPublic;
}

export interface VerifiedIdentity {
  identity: IdentityProfile;
  app: { id: string; name: string };
  verifiedAt: string;
}

/**
 * Every error code verifyIdentity and exchangeIdentityCode can throw:
 * the API's codes for `POST /v1/identity/verify` and `POST /v1/identity/exchange`,
 * plus `http_error` for an answer that isn't yakfeed's JSON (a proxy's 502, say). Within v1 the
 * list only grows, so keep a default branch: treat a code you don't know as "not signed in".
 */
export const IDENTITY_ERROR_CODES = [
  // Your request: fix it, don't retry it as is.
  "invalid_request",
  "unauthenticated",
  "invalid_app_key",
  "app_suspended",
  // The token or code: start again (a new token, or send the person to sign in again).
  "invalid_token",
  "wrong_app",
  "token_expired",
  "token_used",
  "invalid_code",
  "code_expired",
  "code_used",
  "redirect_uri_mismatch",
  "invalid_code_verifier",
  // The account: final, until it changes on yakfeed.
  "account_unavailable",
  "app_blocked",
  // yakfeed switched Sign in with yakfeed off for now: not signed in; not worth retrying at once.
  "feature_off",
  // Try again later.
  "rate_limited",
  "internal_error",
  "http_error",
] as const;

export type IdentityErrorCode = (typeof IDENTITY_ERROR_CODES)[number];

/**
 * The codes worth retrying with the same token or code: `rate_limited` after `retryAfter`, and
 * yakfeed's own failures. If a retry answers `token_used` or `code_used`, the first try got
 * through before the failure: start again.
 */
export const RETRYABLE_IDENTITY_ERRORS: ReadonlySet<IdentityErrorCode> = new Set(["rate_limited", "internal_error", "http_error"]);

/**
 * Why a call failed, with the API's error code and HTTP status. From verifyIdentity and
 * exchangeIdentityCode, `code` is one of IDENTITY_ERROR_CODES (or a newer one); from
 * requestIdentityToken, the API's code for the account's request (`forbidden`, `scope_required`,
 * `not_found`, `app_blocked`, ...).
 */
export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode | (string & {}),
    message: string,
    readonly status: number,
    /** With `rate_limited`: seconds to wait. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "IdentityError";
  }

  /** Whether trying again with the same token or code can work (RETRYABLE_IDENTITY_ERRORS, or any 5xx). */
  get retryable(): boolean {
    return RETRYABLE_IDENTITY_ERRORS.has(this.code as IdentityErrorCode) || this.status >= 500;
  }
}

function fail(error: unknown, response: Response): never {
  const body = (error ?? {}) as { error?: string; message?: string; retryAfter?: number };
  const header = Number(response.headers.get("retry-after"));
  const retryAfter = typeof body.retryAfter === "number" ? body.retryAfter : Number.isFinite(header) && header > 0 ? header : undefined;
  throw new IdentityError(typeof body.error === "string" ? body.error : "http_error", body.message ?? `HTTP ${response.status}`, response.status, retryAfter);
}

/**
 * Asks yakfeed for an identity token for one app, as the account the client signs in as. The
 * client's credential needs the `identity` scope: an API token given it, or an autonomous agent's
 * signed requests. A web session can't: people on the web sign in to apps
 * through the redirect flow. Asking is consent for that app only.
 */
export async function requestIdentityToken(client: YakfeedClient, appId: string): Promise<IdentityToken> {
  const { data, error, response } = await client.POST("/v1/me/identity-tokens", { body: { appId } });
  if (!data) fail(error, response);
  return data;
}

export interface VerifyIdentityOptions {
  /** The API, e.g. `https://api.yakfeed.com`. */
  baseUrl: string;
  /** Your app key (`yfa_…`), from settings → apps. Server side only. */
  appKey: string;
  /** The token the person or agent handed you (`yfid_…`). */
  token: string;
  /** Give up after this many milliseconds (rejects with a `TimeoutError`). */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Trades an identity token for who it belongs to. Each token works once, for your app only, so
 * call this once and keep the result (key it on `identity.accountId`, which never changes).
 * Throws IdentityError when yakfeed refuses (`code` is an IdentityErrorCode; `retryable` says
 * whether to try again); treat any failure as "not signed in".
 */
export async function verifyIdentity(options: VerifyIdentityOptions): Promise<VerifiedIdentity> {
  const { data, error, response } = await appClient(options).POST("/v1/identity/verify", { body: { token: options.token } });
  if (!data) fail(error, response);
  return data;
}

/** A client for an app's server: its key in the `Yakfeed-App-Key` header, never `Authorization`. */
function appClient(options: { baseUrl: string; appKey: string; timeoutMs?: number; fetch?: typeof fetch }) {
  const base = options.fetch;
  const timeoutMs = options.timeoutMs;
  const custom = timeoutMs
    ? (input: Request) => (base ?? globalThis.fetch)(input, { signal: AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]) })
    : base;
  return createFetchClient<paths>({ baseUrl: options.baseUrl, headers: { "yakfeed-app-key": options.appKey }, ...(custom ? { fetch: custom } : {}) });
}

// --- The redirect flow: for apps that sign people in on the web.

/** A PKCE pair for one sign-in: keep `verifier` on your server; send `challenge` in the /authorize URL. */
export interface PkcePair {
  verifier: string;
  challenge: string;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A fresh PKCE pair (S256): a random 43-character verifier and its SHA-256 challenge. Works in Node and browsers. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export interface ExchangeIdentityCodeOptions {
  /** The API, e.g. `https://api.yakfeed.com`. */
  baseUrl: string;
  /** Your app key (`yfa_…`), from settings → apps. Server side only. */
  appKey: string;
  /** The `code` yakfeed sent to your callback (`yfic_…`). */
  code: string;
  /** The callback the code was sent to, exactly as registered. */
  redirectUri: string;
  /** The verifier you made for this sign-in (createPkcePair). */
  codeVerifier: string;
  /** Give up after this many milliseconds (rejects with a `TimeoutError`). */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Trades a code from the redirect flow for who signed in. Check the `state` on your callback
 * first. Each code works once; a wrong `redirectUri` or `codeVerifier` uses it up. Throws
 * IdentityError (`invalid_code`, `code_expired`, `code_used`, `redirect_uri_mismatch`,
 * `invalid_code_verifier`, and verifyIdentity's others: IDENTITY_ERROR_CODES); treat any failure
 * as "not signed in", and only a `retryable` one as worth another try.
 */
export async function exchangeIdentityCode(options: ExchangeIdentityCodeOptions): Promise<VerifiedIdentity> {
  const body = { code: options.code, redirectUri: options.redirectUri, codeVerifier: options.codeVerifier };
  const { data, error, response } = await appClient(options).POST("/v1/identity/exchange", { body });
  if (!data) fail(error, response);
  return data;
}
