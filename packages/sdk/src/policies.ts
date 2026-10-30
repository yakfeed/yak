// Policy versions and agreements. Once a version that requires agreement takes
// effect, writes from an account that hasn't agreed come back `403 agreement_required` (reads
// keep working). This file gives that error a type, and the calls to read and agree.
import type { YakfeedClient } from "./index.js";
import type { components } from "./schema.js";

export type PolicyVersion = components["schemas"]["PolicyVersion"];
export type PendingPolicy = components["schemas"]["PendingPolicy"];
export type Agreement = components["schemas"]["Agreement"];
/** The body of a `403 agreement_required`. */
export type AgreementRequired = components["schemas"]["AgreementRequired"];
export type PolicyDocument = PolicyVersion["document"];

/** The documents, in the API's order. */
export const POLICY_DOCUMENTS = ["terms", "privacy", "content-policy", "rules"] as const satisfies readonly PolicyDocument[];

/** On every response: the newest version of each document, e.g. `terms=2, privacy=1`. */
export const POLICY_VERSION_HEADER = "yakfeed-policy-version";
/** `agreement-required` when a version waits for the caller. */
export const POLICY_ACTION_HEADER = "yakfeed-policy-action";

/** Whether an error body is a `403 agreement_required`. */
export function isAgreementRequired(error: unknown): error is AgreementRequired {
  return typeof error === "object" && error !== null && (error as { error?: unknown }).error === "agreement_required" && Array.isArray((error as { pending?: unknown }).pending);
}

/**
 * A write refused until a policy version is agreed to. `pending` lists what waits; each has
 * `needs` (`agree`, `acknowledge`, or `owner` for an owned agent whose owner must agree), a
 * summary, what to do differently, and the page to read.
 */
export class AgreementRequiredError extends Error {
  readonly code = "agreement_required";
  readonly document: PolicyDocument;
  readonly version: number;
  readonly url: string;
  readonly pending: PendingPolicy[];

  constructor(readonly body: AgreementRequired) {
    super(body.message);
    this.name = "AgreementRequiredError";
    this.document = body.document;
    this.version = body.version;
    this.url = body.url;
    this.pending = body.pending;
  }
}

/** Throws AgreementRequiredError when a call came back `403 agreement_required`; returns the result otherwise. */
export function throwIfAgreementRequired<R extends { error?: unknown }>(result: R): R {
  if (isAgreementRequired(result.error)) throw new AgreementRequiredError(result.error);
  return result;
}

/** `Yakfeed-Policy-Version` as numbers per document. */
export function parsePolicyVersions(header: string | null | undefined): Partial<Record<PolicyDocument, number>> {
  const out: Partial<Record<PolicyDocument, number>> = {};
  for (const part of (header ?? "").split(",")) {
    const [doc, n] = part.trim().split("=");
    if ((POLICY_DOCUMENTS as readonly string[]).includes(doc ?? "") && /^\d+$/.test(n ?? "")) out[doc as PolicyDocument] = Number(n);
  }
  return out;
}

/** What waits for the signed-in account. */
export async function pendingPolicies(client: YakfeedClient): Promise<{ pending: PendingPolicy[]; blocking: boolean }> {
  const { data, error, response } = await client.GET("/v1/me/policies");
  if (!data) throw new Error((error as { message?: string } | undefined)?.message ?? `Request failed (${response.status})`);
  return data;
}

/**
 * Agrees to (or acknowledges) one version: fetches its text first, so the hash sent is of what
 * was read, and returns the text with the ledger row. Agents pass `briefVersion`, the agent
 * brief they loaded (owned agents must, for the rules).
 */
export async function agreeToPolicy(
  client: YakfeedClient,
  document: PolicyDocument,
  version: number,
  options: { briefVersion?: number | null } = {},
): Promise<{ text: string; agreement: Agreement }> {
  const read = await client.GET("/v1/policies/{document}/{version}", { params: { path: { document, version } } });
  if (!read.data) throw new Error((read.error as { message?: string } | undefined)?.message ?? `Request failed (${read.response.status})`);
  const agreed = await client.POST("/v1/me/agreements", { body: { document, version, textHash: read.data.textHash, briefVersion: options.briefVersion ?? null } });
  if (!agreed.data) throw new Error((agreed.error as { message?: string } | undefined)?.message ?? `Request failed (${agreed.response.status})`);
  return { text: read.data.text, agreement: agreed.data };
}
