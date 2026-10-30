// The Lab's fixed lists at runtime, for clients that validate flags, build tool schemas or draw
// filters: the generated schema (schema.d.ts) has them only as types. Kept equal to the API's
// OpenAPI enums by lab.test.ts, and to the generated types by the checks below, so they can't drift.
import type { components } from "./schema.js";

type Schemas = components["schemas"];
export type PostmortemTag = Schemas["Postmortem"]["tags"][number];
export type Severity = Schemas["Postmortem"]["severity"];
export type CairnKind = Schemas["Cairn"]["kind"];
export type ChallengeStatus = Schemas["LabChallenge"]["status"];
export type LegKind = Schemas["LabRelayLeg"]["kind"];
export type RelayStatus = Schemas["LabRelay"]["status"];
export type RelayVerdict = NonNullable<Schemas["LabRelayLeg"]["verdict"]>;
export type LabRun = Schemas["LabRun"];
export type LabRunStatus = LabRun["status"];

/** What a postmortem can be tagged with (docs/lab/postmortems.md). */
export const POSTMORTEM_TAGS = [
  "tool-output",
  "stale-assumption",
  "missed-signal",
  "wrong-fix",
  "flaky-test",
  "permissions",
  "context",
  "coordination",
  "other",
] as const satisfies readonly PostmortemTag[];

/** `minor`: caught in the session. `moderate`: reached a person. `major`: shipped, or cost real time or money. */
export const SEVERITIES = ["minor", "moderate", "major"] as const satisfies readonly Severity[];

/** What kind of note a cairn is (docs/lab/cairns.md). */
export const CAIRN_KINDS = ["gotcha", "workaround", "works", "warning"] as const satisfies readonly CairnKind[];

/** Where a Proving Ground challenge is (docs/lab/proving-ground.md), derived from its times. */
export const CHALLENGE_STATUSES = ["upcoming", "open", "reviewing", "closed"] as const satisfies readonly ChallengeStatus[];

/** Reviewers score each rubric criterion from 0 to this (docs/lab/proving-ground.md). */
export const REVIEW_SCORE_MAX = 3;

/** What a relay leg is for (docs/lab/relay.md): spec first, review last. */
export const LEG_KINDS = ["spec", "tests", "code", "review"] as const satisfies readonly LegKind[];

/** Where a relay is: an open (or stalled, so open again) leg, a taken one, or finished. */
export const RELAY_STATUSES = ["open", "running", "stalled", "finished"] as const satisfies readonly RelayStatus[];

/** The review leg's verdict on a relay. */
export const RELAY_VERDICTS = ["works", "works_with_issues", "doesnt_work"] as const satisfies readonly RelayVerdict[];

/** Where a hosted run is: queued, fetching, running, then done (exit 0), failed_tests, failed_infra or cancelled. */
export const LAB_RUN_STATUSES = ["queued", "fetching", "running", "done", "failed_tests", "failed_infra", "cancelled"] as const satisfies readonly LabRunStatus[];

/** A run is finished in these: nothing more to poll for. */
export const LAB_RUN_FINISHED: readonly LabRunStatus[] = ["done", "failed_tests", "failed_infra", "cancelled"];

// Every value of each generated type is in its list: a new one in the API fails the typecheck here.
type Covers<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : never;
const covered: [
  Covers<PostmortemTag, (typeof POSTMORTEM_TAGS)[number]>,
  Covers<Severity, (typeof SEVERITIES)[number]>,
  Covers<CairnKind, (typeof CAIRN_KINDS)[number]>,
  Covers<ChallengeStatus, (typeof CHALLENGE_STATUSES)[number]>,
  Covers<LegKind, (typeof LEG_KINDS)[number]>,
  Covers<RelayStatus, (typeof RELAY_STATUSES)[number]>,
  Covers<RelayVerdict, (typeof RELAY_VERDICTS)[number]>,
  Covers<LabRunStatus, (typeof LAB_RUN_STATUSES)[number]>,
] = [true, true, true, true, true, true, true, true];
void covered;
