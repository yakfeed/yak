import { describe, expect, it } from "vitest";
import { OAuthError, readRedirect, refreshingTokenSource, withTokenSource } from "./oauth.js";
import type { AppSignIn, SignInStore } from "./oauth.js";

const later = (ms: number) => new Date(Date.now() + ms).toISOString();

function memoryStore(initial: AppSignIn | null): SignInStore & { value: AppSignIn | null; locks: number } {
  let queue: Promise<unknown> = Promise.resolve();
  const s = {
    value: initial,
    locks: 0,
    read: async () => s.value,
    write: async (v: AppSignIn | null) => void (s.value = v),
    withLock: <T>(fn: () => Promise<T>) => {
      s.locks++;
      const next = queue.then(fn, fn);
      queue = next.catch(() => undefined);
      return next;
    },
  };
  return s;
}

/** A token endpoint that rotates: each refresh token works once. */
function tokenEndpoint() {
  let n = 0;
  const live = new Set(["yfr_0"]);
  const calls: string[] = [];
  const endpoint = (async (_url: string, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body));
    calls.push(form.get("refresh_token")!);
    if (!live.delete(form.get("refresh_token")!)) return new Response(JSON.stringify({ error: "invalid_grant", error_description: "used" }), { status: 400 });
    n++;
    live.add(`yfr_${n}`);
    return new Response(JSON.stringify({ access_token: `yfo_${n}`, token_type: "Bearer", expires_in: 3600, refresh_token: `yfr_${n}`, scope: "read" }));
  }) as typeof globalThis.fetch;
  return { fetch: endpoint, calls };
}

describe("refreshingTokenSource", () => {
  it("uses a fresh token as is, and refreshes a stale one once, under the lock, even when asked twice at once", async () => {
    const store = memoryStore({ accessToken: "yfo_0", accessExpiresAt: later(-1000), refreshToken: "yfr_0", scope: "read" });
    const t = tokenEndpoint();
    const source = refreshingTokenSource({ apiUrl: "https://api.example", clientId: "yak", store, fetch: t.fetch });
    const [a, b] = await Promise.all([source.current(), source.current()]);
    expect([a, b]).toEqual(["yfo_1", "yfo_1"]);
    expect(t.calls).toEqual(["yfr_0"]);
    expect(store.value).toMatchObject({ accessToken: "yfo_1", refreshToken: "yfr_1" });
    expect(await source.current()).toBe("yfo_1");
  });

  it("re-reads the store before refreshing: another process's refresh is used, not repeated", async () => {
    const store = memoryStore({ accessToken: "yfo_9", accessExpiresAt: later(3_600_000), refreshToken: "yfr_9", scope: "read" });
    const t = tokenEndpoint();
    const source = refreshingTokenSource({ apiUrl: "https://api.example", clientId: "yak", store, fetch: t.fetch });
    expect(await source.refresh("yfo_old")).toBe("yfo_9");
    expect(t.calls).toEqual([]);
  });

  it("forgets the sign-in when the server ended it", async () => {
    const store = memoryStore({ accessToken: "yfo_x", accessExpiresAt: later(-1000), refreshToken: "yfr_gone", scope: "read" });
    const source = refreshingTokenSource({ apiUrl: "https://api.example", clientId: "yak", store, fetch: tokenEndpoint().fetch });
    expect(await source.current()).toBeNull();
    expect(store.value).toBeNull();
  });

  it("keeps the sign-in while signing in is paused (503), and says when to try again", async () => {
    const saved = { accessToken: "yfo_x", accessExpiresAt: later(-1000), refreshToken: "yfr_kept", scope: "read" };
    const store = memoryStore(saved);
    const paused = (async () =>
      new Response(JSON.stringify({ error: "temporarily_unavailable", error_description: "paused" }), { status: 503, headers: { "retry-after": "900" } })) as typeof globalThis.fetch;
    const source = refreshingTokenSource({ apiUrl: "https://api.example", clientId: "yak", store, fetch: paused });
    const error = await source.current().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OAuthError);
    expect(error).toMatchObject({ status: 503, code: "temporarily_unavailable", retryAfter: 900 });
    expect(store.value).toEqual(saved);
  });
});

describe("readRedirect", () => {
  const url = (q: Record<string, string>) => new URL(`http://127.0.0.1:1/callback?${new URLSearchParams(q)}`);
  it("takes the code when state and iss match", () => {
    expect(readRedirect(url({ code: "c", state: "s", iss: "https://api.example" }), { state: "s", issuer: "https://api.example" })).toBe("c");
  });
  it("refuses an answer without iss, or from another issuer, when the issuer is known (RFC 9207 2.4)", () => {
    expect(() => readRedirect(url({ code: "c", state: "s" }), { state: "s", issuer: "https://api.example" })).toThrow(/iss/);
    expect(() => readRedirect(url({ code: "c", state: "s", iss: "https://evil.example" }), { state: "s", issuer: "https://api.example" })).toThrow(/iss/);
  });
});

describe("withTokenSource", () => {
  it("retries a 401 once with a refreshed token, the body sent again", async () => {
    const seen: [string | null, string][] = [];
    const base = async (req: Request) => {
      seen.push([req.headers.get("authorization"), await req.text()]);
      return new Response(null, { status: req.headers.get("authorization") === "Bearer new" ? 200 : 401 });
    };
    const f = withTokenSource(base, { current: async () => "old", refresh: async () => "new" });
    const res = await f(new Request("https://api.example/v1/x", { method: "POST", body: "{}" }));
    expect(res.status).toBe(200);
    expect(seen).toEqual([
      ["Bearer old", "{}"],
      ["Bearer new", "{}"],
    ]);
  });
});
