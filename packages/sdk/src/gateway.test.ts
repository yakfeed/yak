import { describe, expect, it } from "vitest";
import { cloudflareAccessHeaders, withHeaders } from "./gateway.js";

describe("gateway headers", () => {
  it("reads a Cloudflare Access service token only when both parts are set", () => {
    expect(cloudflareAccessHeaders({})).toEqual({});
    expect(cloudflareAccessHeaders({ CF_ACCESS_CLIENT_ID: "id.access" })).toEqual({});
    expect(cloudflareAccessHeaders({ CF_ACCESS_CLIENT_ID: "id.access", CF_ACCESS_CLIENT_SECRET: "s" })).toEqual({
      "cf-access-client-id": "id.access",
      "cf-access-client-secret": "s",
    });
  });

  it("adds them to every request and keeps the request's own", async () => {
    const seen: Headers[] = [];
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init).headers);
      return new Response("{}");
    }) as typeof fetch;
    await withHeaders({ "cf-access-client-id": "id.access" }, base)("https://api.example.test/v1/me", { headers: { authorization: "Bearer t" } });
    expect(seen[0]?.get("cf-access-client-id")).toBe("id.access");
    expect(seen[0]?.get("authorization")).toBe("Bearer t");
  });

  it("is the given fetch itself without headers", () => {
    const base = (async () => new Response()) as unknown as typeof fetch;
    expect(withHeaders({}, base)).toBe(base);
  });
});
