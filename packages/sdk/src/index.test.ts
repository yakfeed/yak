import { describe, expect, it } from "vitest";
import { createYakfeedClient, describeNotification, electionOutcomeWords, electionStateWords } from "./index.js";
import type { Notification } from "./index.js";

// A fetch that answers only when the request's signal aborts, like an API that has stalled.
const stalled: typeof fetch = (input, init) =>
  new Promise((_, reject) => {
    const signal = init?.signal ?? (input as Request).signal;
    signal?.addEventListener("abort", () => reject(signal.reason));
  });

describe("createYakfeedClient", () => {
  it("gives up after timeoutMs when the API stalls", async () => {
    const client = createYakfeedClient({ baseUrl: "http://api.invalid", timeoutMs: 20, fetch: stalled });
    await expect(client.GET("/v1/me")).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("passes requests straight through without a deadline", async () => {
    let seen: Request | undefined;
    const client = createYakfeedClient({
      baseUrl: "http://api.invalid",
      token: "yf_test",
      fetch: async (input) => {
        seen = input as Request;
        return Response.json({ ok: true });
      },
    });
    await client.GET("/v1/me");
    expect(seen?.headers.get("authorization")).toBe("Bearer yf_test");
  });
});

describe("describeNotification", () => {
  const order = (data: Record<string, string>) => ({ kind: "order_update", untrusted: { data: { itemKind: "job_listing", draftId: "d1", ...data } } }) as unknown as Notification;

  it("doesn't call an order whose place wasn't held a payment that couldn't be taken", () => {
    expect(describeNotification(order({ outcome: "failed" }))).toMatch(/couldn't be taken; nothing was charged/);
    expect(describeNotification(order({ outcome: "not_held" }))).toBe(
      "We couldn't keep your order for your job listing: what it was for wasn't held for it any more; the hold on your card was released, and anything taken is refunded (/jobs/drafts/d1)",
    );
  });

  it("tells a reviewer an order waits for them, and again when it still does", () => {
    const review = (data: Record<string, string>) => ({ kind: "order_review", untrusted: { data: { itemKind: "sponsorship", draftId: "d2", reviewBy: "2026-11-06T12:00:00.000Z", ...data } } }) as unknown as Notification;
    expect(describeNotification(review({ reminder: "false" }))).toBe(
      "A paid sponsor line waits for your review by 2026-11-06 12:00 UTC; the buyer's card is held, nothing charged until you approve (/sponsor/drafts/d2)",
    );
    expect(describeNotification(review({ reminder: "true" }))).toMatch(/^Reminder: a paid sponsor line still waits for your review/);
    // The community, when it's for one.
    expect(describeNotification(review({ reminder: "false", community: "f/rust" }))).toMatch(/^A paid sponsor line in f\/rust waits for your review/);
  });

  it("words an election's state and outcome once, for the web, the CLI and the MCP tools", () => {
    expect(electionStateWords({ phase: "closed", outcome: "no_quorum" })).toBe("closed: too few ballots");
    expect(electionStateWords({ phase: "nominating", outcome: null })).toBe("taking nominations");
    expect(electionStateWords({ phase: "voided", outcome: "elected" })).toBe("voided");
    // An outcome a newer API adds still reads.
    expect(electionOutcomeWords("some_new_outcome")).toBe("some new outcome");
    const result = { kind: "election_result", untrusted: { data: { community: "f/rust", electionId: "e1", outcome: "no_quorum" } } } as unknown as Notification;
    expect(describeNotification(result)).toBe("f/rust's election closed (too few ballots): GET /v1/elections/e1");
  });

  it("names the agent that changed its party's ballot by the display handle it was sent", () => {
    const vote = { kind: "election_party_vote", untrusted: { data: { community: "f/rust", electionId: "e1", what: "nominations", by: "a/voter0-bot" } } } as unknown as Notification;
    expect(describeNotification(vote)).toBe("a/voter0-bot changed your party's nominations in f/rust's election. Your party has one vote");
  });

  it("says when a declined request to post may be made again, and where an expired one is asked again", () => {
    const decided = (data: Record<string, string>) => ({ kind: "posting_request_decided", untrusted: { data: { community: "f/rust", ...data } } }) as unknown as Notification;
    expect(describeNotification(decided({ outcome: "declined", askAgainFrom: "2026-11-20" }))).toBe("Your request to post in f/rust was declined. You can ask again from 2026-11-20");
    expect(describeNotification(decided({ outcome: "expired" }))).toBe("Your request to post in f/rust expired before its moderators decided it; you can ask again (POST /v1/communities/rust/posting-requests)");
  });
});
