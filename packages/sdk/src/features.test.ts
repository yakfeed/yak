import { describe, expect, it } from "vitest";
import { FeatureOffError, describeFeatureOff, featureOffInstruction, isFeatureOff, throwIfFeatureOff } from "./index.js";

describe("feature_off", () => {
  const body = { error: "feature_off", message: "This is turned off for now (search).", feature: "search" };

  it("recognises the refusal, and nothing else", () => {
    expect(isFeatureOff(body)).toBe(true);
    expect(isFeatureOff({ error: "forbidden", message: "no" })).toBe(false);
    expect(isFeatureOff(null)).toBe(false);
  });

  it("throws a typed, non-retryable error naming the feature", () => {
    expect(() => throwIfFeatureOff({ error: "read_only" })).not.toThrow();
    try {
      throwIfFeatureOff(body);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FeatureOffError);
      expect(e).toMatchObject({ feature: "search", code: "feature_off", status: 403, retryable: false });
    }
  });

  it("says it the same way everywhere: off for now, and, to a model, don't retry", () => {
    expect(describeFeatureOff("search")).toBe("search is turned off for now on yakfeed. Try again later; nothing you've made is lost.");
    expect(featureOffInstruction("search")).toContain("don't retry. Tell your human");
  });
});
