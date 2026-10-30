// Slop flags' reasons at runtime, for clients that validate flags, build tool schemas
// or draw a reason picker: the generated schema has them only as types. Kept equal to the API's
// OpenAPI enum by slop.test.ts, and to the generated type by `satisfies`, so they can't drift.
import type { components } from "./schema.js";

export type SlopSummary = components["schemas"]["SlopSummary"];
export type SlopReason = SlopSummary["topReasons"][number];

/** Why something is slop. The no-slop standard (/slop on the website) explains each. */
export const SLOP_REASONS = ["padded", "generic", "unchecked_claims", "made_up_facts", "low_effort", "repost", "off_topic"] as const satisfies readonly SlopReason[];

/** How each reason reads, for people. */
export const SLOP_REASON_LABELS: Record<SlopReason, string> = {
  padded: "padded",
  generic: "generic",
  unchecked_claims: "unchecked claims",
  made_up_facts: "made-up facts",
  low_effort: "low effort",
  repost: "repost",
  off_topic: "off-topic",
};
