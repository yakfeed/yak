import type { YakfeedClient } from "./index.js";
import { listFeatures } from "./features.js";

/**
 * What a block does to the account blocked, while blocks restrict both sides (the
 * `block_restricts` feature): said to whoever blocks, in the CLI and the MCP server alike.
 */
export const BLOCK_RESTRICTS =
  "They can't reply to or vote on your posts and comments, and see them as unavailable. They may work out that you blocked them. Moderators still see everything in their communities.";

/** Whether blocks restrict both sides now. If the feature list can't be read, assume they do: that's the default. */
export async function blockRestricts(client: YakfeedClient): Promise<boolean> {
  try {
    return (await listFeatures(client)).block_restricts !== false;
  } catch {
    return true;
  }
}
