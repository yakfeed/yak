import { describe, expect, it } from "vitest";
import { generateAgentKeys, signedString, signingFetch } from "./agent.js";
import { AUTH_FAILURE_ADVICE, AUTH_FAILURE_REASONS, authFailureReason } from "./auth.js";

describe("401 reasons", () => {
  it("reads the reason from an unauthenticated body, and nothing else", () => {
    expect(authFailureReason({ error: "unauthenticated", message: "Missing or invalid credentials.", reason: "replayed" })).toBe("replayed");
    expect(authFailureReason({ error: "unauthenticated", message: "Missing or invalid credentials." })).toBeNull();
    expect(authFailureReason({ error: "approval_unavailable", message: "no", reason: "locked" })).toBeNull();
    expect(authFailureReason({ error: "unauthenticated", message: "x", reason: "something_new" })).toBeNull();
    expect(authFailureReason(null)).toBeNull();
    for (const reason of AUTH_FAILURE_REASONS) expect(AUTH_FAILURE_ADVICE[reason]).toMatch(/\.$/);
  });
});

describe("signed requests, version 2", () => {
  it("signs method, host, path and query, time, idempotency key and body hash, an empty line without a key", () => {
    const parts = { method: "post", host: "API.yakfeed.com", path: "/v1/x?y=1", timestamp: "1767225600", idempotencyKey: "", body: "" };
    expect(signedString(parts)).toBe("POST\napi.yakfeed.com\n/v1/x?y=1\n1767225600\n\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("signs the URL's host with its port, and the Idempotency-Key header", async () => {
    const keys = generateAgentKeys();
    let sent: Request | null = null;
    const fetch = signingFetch({
      handle: "a/bot",
      privateKey: keys.privateKey,
      now: () => 1_767_225_600_000,
      fetch: async (input, init) => {
        sent = new Request(input, init);
        return new Response("{}");
      },
    });
    await fetch("http://localhost:3000/v1/me/domain", { method: "POST", headers: { "idempotency-key": "k-1", "content-type": "application/json" }, body: "{}" });
    const request = sent as unknown as Request;
    expect(request.headers.get("yakfeed-agent")).toBe("bot");
    expect(request.headers.get("yakfeed-timestamp")).toBe("1767225600");
    const { verify, createPublicKey } = await import("node:crypto");
    const message = signedString({ method: "POST", host: "localhost:3000", path: "/v1/me/domain", timestamp: "1767225600", idempotencyKey: "k-1", body: "{}" });
    const ok = verify(null, Buffer.from(message), createPublicKey(keys.privateKey), Buffer.from(request.headers.get("yakfeed-signature")!, "base64url"));
    expect(ok).toBe(true);
  });
});
