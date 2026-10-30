import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { idempotentFetch, takesIdempotencyKey } from "./idempotency.js";
import { IDEMPOTENT_OPERATIONS } from "./idempotent-operations.js";
import { createYakfeedClient } from "./index.js";

const noWait = async () => undefined;

function recorder(answers: (Response | Error)[]) {
  const seen: { method: string; url: string; key: string | null; body: string }[] = [];
  const fetch = async (request: Request) => {
    seen.push({ method: request.method, url: request.url, key: request.headers.get("idempotency-key"), body: request.body ? await request.text() : "" });
    const next = answers.shift() ?? new Response("{}", { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  };
  return { seen, fetch };
}

describe("Idempotency-Key in the client", () => {
  it("knows the operations that take a key, from the API description", () => {
    const spec = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")) as { paths: Record<string, Record<string, { parameters?: { in: string; name: string }[] }>> };
    const fromSpec = Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.entries(ops)
        .filter(([, op]) => (op.parameters ?? []).some((p) => p.in === "header" && p.name === "idempotency-key"))
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );
    expect([...IDEMPOTENT_OPERATIONS].sort(), "src/idempotent-operations.ts is stale: run pnpm sdk").toEqual(fromSpec.sort());
    expect(takesIdempotencyKey("POST", "/v1/communities/rust/posts")).toBe(true);
    expect(takesIdempotencyKey("PUT", "/v1/posts/abc/vote")).toBe(true);
    expect(takesIdempotencyKey("GET", "/v1/posts/abc")).toBe(false);
    expect(takesIdempotencyKey("POST", "/v1/me/tokens")).toBe(false);
  });

  it("sends a fresh key per call on writes that take one, and none elsewhere", async () => {
    const r = recorder([]);
    let n = 0;
    const f = idempotentFetch(r.fetch, { newKey: () => `key-${++n}`, sleep: noWait });
    await f(new Request("https://api.example/v1/posts/abc/vote", { method: "PUT", body: "{}" }));
    await f(new Request("https://api.example/v1/posts/abc/vote", { method: "PUT", body: "{}" }));
    await f(new Request("https://api.example/v1/posts/abc"));
    await f(new Request("https://api.example/v1/me/tokens", { method: "POST", body: "{}" }));
    expect(r.seen.map((s) => s.key)).toEqual(["key-1", "key-2", null, null]);
  });

  it("keeps the caller's own key", async () => {
    const r = recorder([]);
    const f = idempotentFetch(r.fetch, { sleep: noWait });
    await f(new Request("https://api.example/v1/posts/abc/comments", { method: "POST", body: "{}", headers: { "idempotency-key": "mine" } }));
    expect(r.seen[0]!.key).toBe("mine");
  });

  it("retries once, with the same key and body, after a dropped connection, a 502-504 or a key still in use", async () => {
    for (const failure of [new TypeError("fetch failed"), new Response("", { status: 503 }), new Response(JSON.stringify({ error: "idempotency_key_in_use" }), { status: 409, headers: { "retry-after": "1" } })]) {
      const r = recorder([failure, new Response("{}", { status: 201, headers: { "idempotent-replayed": "true" } })]);
      const waits: number[] = [];
      const f = idempotentFetch(r.fetch, { newKey: () => "k", sleep: async (ms) => void waits.push(ms) });
      const res = await f(new Request("https://api.example/v1/communities/rust/posts", { method: "POST", body: '{"title":"Hi"}' }));
      expect(res.status).toBe(201);
      expect(r.seen).toHaveLength(2);
      expect(r.seen[1]).toEqual(r.seen[0]);
      expect(waits).toHaveLength(1);
    }
  });

  it("doesn't retry a deadline, another 409, or a write that takes no key", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const r = recorder([timeout]);
    const f = idempotentFetch(r.fetch, { sleep: noWait });
    await expect(f(new Request("https://api.example/v1/communities/rust/posts", { method: "POST", body: "{}" }))).rejects.toThrow("timed out");
    const conflict = recorder([new Response(JSON.stringify({ error: "duplicate_link" }), { status: 409 })]);
    expect((await idempotentFetch(conflict.fetch, { sleep: noWait })(new Request("https://api.example/v1/communities/rust/posts", { method: "POST", body: "{}" }))).status).toBe(409);
    const unkeyed = recorder([new Response("", { status: 503 })]);
    expect((await idempotentFetch(unkeyed.fetch, { sleep: noWait })(new Request("https://api.example/v1/me/tokens", { method: "POST", body: "{}" }))).status).toBe(503);
    expect(r.seen.length + conflict.seen.length + unkeyed.seen.length).toBe(3);
  });

  it("matches operations under a base URL with a path", async () => {
    const r = recorder([]);
    const client = createYakfeedClient({ baseUrl: "https://example.com/api", fetch: r.fetch as typeof fetch });
    await client.PUT("/v1/posts/{id}/vote", { params: { path: { id: "abc" } }, body: { value: 1 } });
    expect(r.seen[0]).toMatchObject({ url: "https://example.com/api/v1/posts/abc/vote", key: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });
});
