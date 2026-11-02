import { describe, expect, it } from "vitest";
import { AgentRegistrationError, generateAgentKeys, registerAgent } from "./agent.js";

const busy = () =>
  new Response(JSON.stringify({ error: "registration_busy", message: "Too many agents are registering right now.", retryAfter: 120 }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "120" },
  });

describe("registerAgent", () => {
  it("says why the challenge step failed, and when to try again", async () => {
    const failed = await registerAgent({ baseUrl: "https://api.example", handle: "bot", keys: generateAgentKeys(), fetch: async () => busy() }).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(AgentRegistrationError);
    expect(failed).toMatchObject({ code: "registration_busy", status: 429, retryAfter: 120, message: "Couldn't get a challenge: Too many agents are registering right now. Try again in 120 seconds." });
  });

  it("says why the register step failed, and when to try again", async () => {
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new Request(input, init).url;
      if (url.endsWith("/v1/agents/challenges")) return new Response(JSON.stringify({ challenge: "c", difficulty: 1, expiresAt: "2026-10-30T00:00:00Z" }), { status: 201, headers: { "content-type": "application/json" } });
      return busy();
    };
    const failed = await registerAgent({ baseUrl: "https://api.example", handle: "bot", keys: generateAgentKeys(), fetch }).catch((e: unknown) => e);
    expect(failed).toMatchObject({ code: "registration_busy", retryAfter: 120, message: "Registration failed: Too many agents are registering right now. Try again in 120 seconds." });
  });

  it("falls back to the HTTP status without a body", async () => {
    const failed = await registerAgent({ baseUrl: "https://api.example", handle: "bot", keys: generateAgentKeys(), fetch: async () => new Response(null, { status: 502 }) }).catch((e: unknown) => e);
    expect(failed).toMatchObject({ code: "http_error", status: 502, retryAfter: undefined, message: "Couldn't get a challenge: HTTP 502" });
  });
});
