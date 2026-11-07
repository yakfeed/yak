// Signing an app in on a device: yakfeed is an OAuth 2.0 authorization server for its own apps
// (`yak`, the MCP server, the phone apps). Three ways in, each ending in a sign-in with a one-hour
// access token and a refresh token used once and replaced on every refresh:
// - the browser (the authorization code grant with PKCE, RFC 6749 and RFC 7636, a loopback redirect
//   on this computer, RFC 8252 section 7.3): `authorizationUrl`, then `exchangeCode`;
// - a code typed on the website (the device grant, RFC 8628): `startDeviceSignIn`, `pollDeviceSignIn`;
// - and `refreshSignIn`, which a `TokenSource` calls for you.
// Keep the refresh token in the system's keychain where there is one, else in a file only you can read.
import { createPkcePair } from "./identity.js";
import type { PkcePair } from "./identity.js";

/** yakfeed's own clients: public (no secret), each with its own sign-in so they never share a refresh token. */
export const APP_CLIENT_IDS = { cli: "yak", mcp: "yakfeed-mcp" } as const;

/** RFC 8628's grant type. */
export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** The machine an app says it runs on, from the server's fixed list: the sign-in's label is the app's name and this. */
export const DEVICE_HINTS = ["macOS", "Linux", "Windows", "iPhone", "iPad", "Android"] as const;
export type DeviceHint = (typeof DEVICE_HINTS)[number];

/** This machine's hint, from Node's `process.platform` (`darwin`, `linux`, `win32`); null for anything else. */
export function deviceHintFor(platform: string): DeviceHint | null {
  return platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform === "win32" ? "Windows" : null;
}

/** A sign-in as an app keeps it: the access token, when it stops working, and the refresh token. */
export interface AppSignIn {
  accessToken: string;
  /** ISO time the access token stops working. */
  accessExpiresAt: string;
  refreshToken: string;
  /** Its scopes, space-separated. */
  scope: string;
}

/** The token endpoint's answer (RFC 6749 section 5.1). */
interface TokenAnswer {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * An OAuth error from the token, device or revocation endpoint (RFC 6749 section 5.2).
 * `invalid_grant`: the sign-in is over, sign in again. `temporarily_unavailable` (a 503): signing
 * in is paused; keep the sign-in and try again after `retryAfter` seconds.
 */
export class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Device polls: seconds to wait. */
    readonly interval?: number,
    /** Seconds to wait before trying again, from `Retry-After`. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

/** The authorization server's metadata (RFC 8414): where the pages and endpoints are. */
export interface ServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  device_authorization_endpoint: string;
}

export interface OAuthOptions {
  /** The API, e.g. `https://api.yakfeed.com`. */
  apiUrl: string;
  fetch?: typeof fetch;
  /** Extra headers on every call (a gateway's, `Yakfeed-Client`). */
  headers?: Record<string, string>;
}

const call = (o: OAuthOptions) => o.fetch ?? globalThis.fetch;
const trim = (url: string) => url.replace(/\/$/, "");

/** Reads the metadata document from the API's `/.well-known/oauth-authorization-server`. */
export async function serverMetadata(o: OAuthOptions): Promise<ServerMetadata> {
  const res = await call(o)(`${trim(o.apiUrl)}/.well-known/oauth-authorization-server`, { headers: { accept: "application/json", ...o.headers } });
  if (!res.ok) throw new OAuthError(res.status, "server_error", `Couldn't read the sign-in settings (${res.status}).`);
  return (await res.json()) as ServerMetadata;
}

/** Posts a form to an OAuth endpoint and reads its JSON, throwing an OAuthError for an error answer. */
async function postForm<T>(o: OAuthOptions, url: string, form: Record<string, string>): Promise<T> {
  const res = await call(o)(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...o.headers },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : "server_error";
    const words = typeof body.error_description === "string" ? body.error_description : typeof body.message === "string" ? body.message : `Request failed (${res.status}).`;
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new OAuthError(res.status, code, words, typeof body.interval === "number" ? body.interval : undefined, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  }
  return body as T;
}

function signInFrom(t: TokenAnswer, now = Date.now()): AppSignIn {
  return { accessToken: t.access_token, accessExpiresAt: new Date(now + t.expires_in * 1000).toISOString(), refreshToken: t.refresh_token, scope: t.scope };
}

// ---------------------------------------------------------------------------
// The browser, with a loopback redirect

/** What to open in the browser, and what to keep to finish: the PKCE verifier and the state. */
export interface AuthorizationRequest {
  url: string;
  verifier: string;
  state: string;
  redirectUri: string;
}

/**
 * The authorization page's URL for a loopback redirect (`http://127.0.0.1:<port>/callback`).
 * Open it in the person's browser, never a web view; they sign in and click to confirm.
 */
export async function authorizationUrl(input: { authorizationEndpoint: string; clientId: string; redirectUri: string; scope?: string; device?: DeviceHint | null; pkce?: PkcePair }): Promise<AuthorizationRequest> {
  const { verifier, challenge } = input.pkce ?? (await createPkcePair());
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  if (input.scope) url.searchParams.set("scope", input.scope);
  if (input.device) url.searchParams.set("device", input.device);
  return { url: url.toString(), verifier, state, redirectUri: input.redirectUri };
}

/**
 * Reads what the browser brought back to the loopback redirect: the code, after checking `state`
 * and, when the issuer is known, `iss` (RFC 9207). yakfeed always sends `iss`, so an answer
 * without it is refused (RFC 9207 section 2.4). Throws an OAuthError for `error=…`.
 */
export function readRedirect(url: URL, expected: { state: string; issuer?: string }): string {
  const q = url.searchParams;
  if (q.get("state") !== expected.state) throw new OAuthError(400, "invalid_request", "The answer doesn't match this sign-in (state). Start again.");
  if (expected.issuer && q.get("iss") !== expected.issuer) throw new OAuthError(400, "invalid_request", "The answer didn't come from the server this sign-in started with (iss). Start again.");
  const error = q.get("error");
  if (error) throw new OAuthError(400, error, error === "access_denied" ? "You said no on the website." : (q.get("error_description") ?? error));
  const code = q.get("code");
  if (!code) throw new OAuthError(400, "invalid_request", "The answer has no code. Start again.");
  return code;
}

/** Exchanges the code for the sign-in's tokens (RFC 6749 section 4.1.3). */
export async function exchangeCode(o: OAuthOptions & { clientId: string; code: string; redirectUri: string; verifier: string }): Promise<AppSignIn> {
  const t = await postForm<TokenAnswer>(o, `${trim(o.apiUrl)}/v1/oauth/token`, { grant_type: "authorization_code", client_id: o.clientId, code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier });
  return signInFrom(t);
}

// ---------------------------------------------------------------------------
// A code typed on the website (RFC 8628)

export interface DeviceSignInStarted {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/** Starts a device sign-in: show the person `user_code` and `verification_uri`; they type it there, signed in. */
export function startDeviceSignIn(o: OAuthOptions & { clientId: string; scope?: string; device?: DeviceHint | null }): Promise<DeviceSignInStarted> {
  return postForm<DeviceSignInStarted>(o, `${trim(o.apiUrl)}/v1/oauth/device_authorization`, {
    client_id: o.clientId,
    ...(o.scope ? { scope: o.scope } : {}),
    ...(o.device ? { device: o.device } : {}),
  });
}

/** Where a device poll stands. */
export type DevicePoll = { status: "pending" | "slow_down"; interval: number } | { status: "denied" } | { status: "expired" } | { status: "signed_in"; signIn: AppSignIn };

/** Polls once (RFC 8628 section 3.4). Wait `interval` seconds between polls. */
export async function pollDeviceSignIn(o: OAuthOptions & { clientId: string; deviceCode: string; interval: number }): Promise<DevicePoll> {
  try {
    const t = await postForm<TokenAnswer>(o, `${trim(o.apiUrl)}/v1/oauth/token`, { grant_type: DEVICE_CODE_GRANT, client_id: o.clientId, device_code: o.deviceCode });
    return { status: "signed_in", signIn: signInFrom(t) };
  } catch (error) {
    if (!(error instanceof OAuthError)) throw error;
    if (error.code === "authorization_pending") return { status: "pending", interval: error.interval ?? o.interval };
    if (error.code === "slow_down") return { status: "slow_down", interval: error.interval ?? o.interval + 5 };
    if (error.code === "access_denied") return { status: "denied" };
    if (error.code === "expired_token") return { status: "expired" };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Refreshing and signing out

/** Refreshes (RFC 6749 section 6): a new pair; the old refresh token stops working. */
export async function refreshSignIn(o: OAuthOptions & { clientId: string; refreshToken: string }): Promise<AppSignIn> {
  const t = await postForm<TokenAnswer>(o, `${trim(o.apiUrl)}/v1/oauth/token`, { grant_type: "refresh_token", client_id: o.clientId, refresh_token: o.refreshToken });
  return signInFrom(t);
}

/** Signs the app out (RFC 7009): either token ends the whole sign-in. */
export async function revokeSignIn(o: OAuthOptions & { clientId: string; token: string }): Promise<void> {
  await postForm<unknown>(o, `${trim(o.apiUrl)}/v1/oauth/revoke`, { token: o.token, client_id: o.clientId });
}

// ---------------------------------------------------------------------------
// A token source: an access token that renews itself

/**
 * Where a sign-in is kept, shared by every process using it (two `yak` commands at once, the MCP
 * server): reads come fresh from the store, and a refresh holds its lock, so one refresh token is
 * never used twice (that would end the sign-in).
 */
export interface SignInStore {
  read(): Promise<AppSignIn | null>;
  /** Saves the new sign-in; null forgets it (the server ended it). */
  write(signIn: AppSignIn | null): Promise<void>;
  /** Runs `fn` holding the store's lock, across processes. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

/** What the client asks for its `Authorization` header. */
export interface TokenSource {
  /** The access token to send now, or null when signed out. */
  current(): Promise<string | null>;
  /** After a 401 with `stale`: a newer token, or null when the sign-in is gone. */
  refresh(stale: string | null): Promise<string | null>;
}

/** Refresh this long before the access token runs out, so a request in flight doesn't meet its end. Unit conversion, not a tunable. */
const EARLY_MS = 60_000;

/**
 * An access token that renews itself from a SignInStore: it re-reads the store before refreshing
 * (another process may have done it), refreshes under the store's lock, and forgets the sign-in
 * only when the server says it ended (`invalid_grant`). Anything else, a 503 while signing in is
 * paused included, keeps the sign-in and throws the OAuthError (with `retryAfter`): try again later.
 */
export function refreshingTokenSource(o: OAuthOptions & { clientId: string; store: SignInStore; now?: () => number }): TokenSource {
  const now = o.now ?? Date.now;
  const fresh = (s: AppSignIn) => Date.parse(s.accessExpiresAt) - EARLY_MS > now();
  const renew = (stale: string | null) =>
    o.store.withLock(async () => {
      const saved = await o.store.read();
      if (!saved) return null;
      // Someone else refreshed while we waited for the lock: use theirs.
      if (saved.accessToken !== stale && fresh(saved)) return saved.accessToken;
      try {
        const next = await refreshSignIn({ ...o, refreshToken: saved.refreshToken });
        await o.store.write(next);
        return next.accessToken;
      } catch (error) {
        // Only a dead grant is forgotten: a pause (503) or an outage keeps the refresh token.
        if (error instanceof OAuthError && error.code === "invalid_grant") {
          await o.store.write(null);
          return null;
        }
        throw error;
      }
    });
  return {
    async current() {
      const saved = await o.store.read();
      if (!saved) return null;
      return fresh(saved) ? saved.accessToken : renew(saved.accessToken);
    },
    refresh: renew,
  };
}

/** Whether `token` is a TokenSource rather than a fixed token. */
export function isTokenSource(token: unknown): token is TokenSource {
  return typeof token === "object" && token !== null && typeof (token as TokenSource).current === "function";
}

/**
 * fetch with the source's access token on every request, and one retry after a 401 with a
 * refreshed one. The request is copied first, so its body can be sent again.
 */
export function withTokenSource(base: (input: Request) => Promise<Response>, source: TokenSource): (input: Request) => Promise<Response> {
  return async (input: Request) => {
    const retry = input.clone();
    const token = await source.current();
    if (token) input.headers.set("authorization", `Bearer ${token}`);
    const res = await base(input);
    if (res.status !== 401 || !token) return res;
    const next = await source.refresh(token);
    if (!next || next === token) return res;
    retry.headers.set("authorization", `Bearer ${next}`);
    return base(retry);
  };
}
