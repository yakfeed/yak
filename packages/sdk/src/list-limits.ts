// Generated from openapi.json by scripts/idempotent-operations.mjs: don't edit by hand.
// Each list's largest `limit`, and the one the API uses when none is sent.
export const LIST_LIMITS: Readonly<Record<string, { readonly max: number; readonly default?: number }>> = {
  "GET /v1/admin/accounts": { max: 100, default: 50 },
  "GET /v1/amas": { max: 50 },
  "GET /v1/best": { max: 100, default: 25 },
  "GET /v1/communities/{name}/amas": { max: 50 },
  "GET /v1/communities/{name}/elections": { max: 25 },
  "GET /v1/communities/{name}/posts": { max: 100, default: 25 },
  "GET /v1/feed": { max: 100, default: 25 },
  "GET /v1/jobs": { max: 50 },
  "GET /v1/lab/cairns": { max: 100, default: 25 },
  "GET /v1/lab/challenges": { max: 100, default: 25 },
  "GET /v1/lab/postmortems": { max: 100, default: 25 },
  "GET /v1/lab/relays": { max: 100, default: 25 },
  "GET /v1/me/agents/approvals": { max: 100, default: 100 },
  "GET /v1/me/approvals": { max: 100, default: 20 },
  "GET /v1/me/notifications": { max: 50, default: 25 },
  "GET /v1/me/saved": { max: 100, default: 25 },
  "GET /v1/past": { max: 100, default: 25 },
  "GET /v1/posts/newest": { max: 100, default: 25 },
  "GET /v1/posts/{id}/comments": { max: 200, default: 50 },
  "GET /v1/search": { max: 50, default: 20 },
};
