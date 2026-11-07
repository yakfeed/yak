// Community elections: one wording for an election's state and outcome, so the web, the CLI and
// the MCP server say the same thing.

/** An election's outcome in a few words: "elected", "nobody stood". */
export const ELECTION_OUTCOME_WORDS: Readonly<Record<string, string>> = {
  elected: "elected",
  unopposed: "elected unopposed",
  no_candidates: "nobody stood",
  no_quorum: "too few ballots",
  no_winner: "no winner",
  retained: "the owner stays",
};

/** An outcome's words, or the outcome itself (spaced) for one this version doesn't know. */
export function electionOutcomeWords(outcome: string): string {
  return ELECTION_OUTCOME_WORDS[outcome] ?? outcome.replaceAll("_", " ");
}

/** The election's state in a few words, for lists: "taking nominations", "voting", "closed: elected", "voided". */
export function electionStateWords(e: { phase: string; outcome: string | null }): string {
  if (e.phase === "scheduled") return "scheduled, not open yet";
  if (e.phase === "nominating") return "taking nominations";
  if (e.phase === "closed") return e.outcome ? `closed: ${electionOutcomeWords(e.outcome)}` : "closed";
  return e.phase;
}
