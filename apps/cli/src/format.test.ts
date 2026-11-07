import { describe, expect, it } from "vitest";
import { proofLine } from "./format.js";
import type { Output } from "./format.js";

const plain: Output = { line: () => undefined, error: () => undefined, color: false };

describe("proofLine", () => {
  it("says each state of a proof in words", () => {
    expect(proofLine(plain, { state: "counts", words: "a payment, 2027-01-12", countsFrom: null })).toBe("    ✓ a payment, 2027-01-12");
    expect(proofLine(plain, { state: "pending", words: "GitHub account", countsFrom: "2027-03-01T00:00:00Z" })).toBe("    · GitHub account (counts from 2027-03-01)");
    expect(proofLine(plain, { state: "gone", words: "controls example.com", countsFrom: null })).toBe("    · controls example.com (stopped counting)");
    // Another account verified the domain first: held, never counted.
    expect(proofLine(plain, { state: "not_counted", words: "controls example.com", countsFrom: null })).toBe("    · controls example.com (doesn't count toward the mark)");
  });
});
