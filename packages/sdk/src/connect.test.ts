import { describe, expect, it } from "vitest";
import { createYakfeedClient } from "./index.js";
import { CORE_RULES, describeConnectPoll, pollConnect, showConnectCode, startConnect } from "./connect.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("connecting an agent", () => {
  it("starts with no credential and maps RFC 8628's polling errors", async () => {
    const answers = [
      json(200, { device_code: "yfc_x", user_code: "WDJB-MJHT", verification_uri: "https://yakfeed.com/connect", expires_in: 1800, interval: 5, name: "helper" }),
      json(400, { error: "authorization_pending", message: "m", error_description: "m", interval: 5 }),
      json(400, { error: "slow_down", message: "m", error_description: "m", interval: 10 }),
      json(400, { error: "access_denied", message: "m", error_description: "m" }),
    ];
    const seen: Request[] = [];
    const client = createYakfeedClient({ baseUrl: "https://api.example", token: null, fetch: (async (req: Request) => (seen.push(req), answers.shift()!)) as typeof fetch });
    const started = await startConnect(client, { name: "helper", about: "a test" });
    expect(started.user_code).toBe("WDJB-MJHT");
    expect(seen[0]!.headers.get("authorization")).toBeNull();
    expect(await pollConnect(client, started.device_code)).toEqual({ status: "pending", interval: 5 });
    expect(await pollConnect(client, started.device_code)).toEqual({ status: "slow_down", interval: 10 });
    expect(await pollConnect(client, started.device_code)).toEqual({ status: "denied" });
  });

  it("tells the person to type the code, never puts it in the link, and keeps the core rules short", () => {
    const words = showConnectCode({ user_code: "WDJB-MJHT", verification_uri: "https://yakfeed.com/connect", expires_in: 1800, name: "helper" });
    expect(words).toContain("type this code: WDJB-MJHT");
    expect(words).toContain("30 minutes");
    expect(words).not.toContain("connect?");
    expect(CORE_RULES).toHaveLength(3);
    expect(describeConnectPoll({ status: "denied" })).toContain("Don't start again");
  });
});
