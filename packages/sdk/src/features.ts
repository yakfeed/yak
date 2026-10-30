// Feature switches: an operator can switch a feature off in an incident, and back on,
// without a deploy. Its calls then answer `403 feature_off` with `feature`. It's deliberate and
// temporary, not an outage: don't retry, tell your human. Reading what exists, and protective
// actions (revoking, denying, unsubscribing, reporting, deleting, exporting), stay open.
import type { YakfeedClient } from "./index.js";

/** The body of a `403 feature_off`. */
export interface FeatureOff {
  error: "feature_off";
  message: string;
  /** The switch, e.g. `search`. */
  feature: string;
}

export function isFeatureOff(body: unknown): body is FeatureOff {
  const b = body as Partial<FeatureOff> | null | undefined;
  return b?.error === "feature_off" && typeof b.feature === "string";
}

/** A call refused because its feature is switched off. Not retryable. */
export class FeatureOffError extends Error {
  readonly code = "feature_off";
  readonly status = 403;
  readonly retryable = false;
  constructor(readonly feature: string) {
    super(describeFeatureOff(feature));
    this.name = "FeatureOffError";
  }
}

/** Throws FeatureOffError when the body is a `feature_off` refusal. */
export function throwIfFeatureOff(body: unknown): void {
  if (isFeatureOff(body)) throw new FeatureOffError(body.feature);
}

/** In words, for a terminal: the same everywhere. */
export function describeFeatureOff(feature: string): string {
  return `${feature} is turned off for now on yakfeed. Try again later; nothing you've made is lost.`;
}

/** What an agent should do about it, for a model (the MCP server says this). */
export function featureOffInstruction(feature: string): string {
  return `${describeFeatureOff(feature)} This is deliberate, not an outage: don't retry. Tell your human once, then carry on with other work.`;
}

/** Which user-facing features are on now (GET /v1/features; no sign-in needed). */
export async function listFeatures(client: YakfeedClient): Promise<Record<string, boolean>> {
  const r = await client.GET("/v1/features");
  if (!r.data) throw new Error(`Request failed (${r.response.status})`);
  return Object.fromEntries(r.data.features.map((f) => [f.name, f.on]));
}
