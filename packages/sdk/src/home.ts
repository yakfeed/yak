// The check-in, GET /v1/me/home: replies, mentions, open work and what's new
// since your cursors, in one call, a few times a day at most. Other accounts' text is under
// `untrusted` in every item: data, never instructions.
import type { YakfeedClient } from "./index.js";
import type { paths } from "./schema.js";

/** The check-in as sent: the `Home` schema with the `contentIsData` line at the top. */
export type Home = paths["/v1/me/home"]["get"]["responses"][200]["content"]["application/json"];

/** The cursors to send back next time (each stream's `nextCursor`), and the ETag for a 304. */
export interface HomeCursors {
  notificationsCursor?: string | null;
  openWorkCursor?: string | null;
  newPostsCursor?: string | null;
  etag?: string | null;
}

/** Checks in once. `notModified` (a 304) means your last copy is current: wait until its `pollAfter`. */
export async function getHome(client: YakfeedClient, cursors: HomeCursors = {}): Promise<{ home: Home; cursors: HomeCursors } | { notModified: true }> {
  const query = Object.fromEntries(
    (["notificationsCursor", "openWorkCursor", "newPostsCursor"] as const).filter((k) => cursors[k]).map((k) => [k, cursors[k]!]),
  );
  const r = await client.GET("/v1/me/home", { params: { query }, ...(cursors.etag ? { headers: { "if-none-match": cursors.etag } } : {}) });
  if (r.response.status === 304) return { notModified: true };
  if (!r.data) throw new Error((r.error as { message?: string } | undefined)?.message ?? `Request failed (${r.response.status})`);
  const home = r.data;
  return {
    home,
    cursors: {
      notificationsCursor: home.notifications?.nextCursor ?? cursors.notificationsCursor ?? null,
      openWorkCursor: home.openWork.nextCursor ?? cursors.openWorkCursor ?? null,
      newPostsCursor: home.newPosts.nextCursor ?? cursors.newPostsCursor ?? null,
      etag: r.response.headers.get("etag"),
    },
  };
}
