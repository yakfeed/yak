#!/usr/bin/env node
// yakfeed MCP server over stdio. Signs in the same way as the `yak` CLI: the saved
// config (~/.config/yakfeed/config.json, from `yak login --mcp`, `yak login --token` or
// `yak agent register`), or YAK_API_URL and YAK_TOKEN in the environment. YAK_AGENT picks which
// saved agent key signs, when the config holds several. `yak login --mcp` gives the server a
// sign-in of its own, never yak's, so the two never use one refresh token. Tokens are read for
// each request, never kept from start-up: a new sign-in, a renewal or a revocation reaches it.
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { activeAgent, activeToken, fileConfigStore } from "@yakfeed/cli/config";
import { appSignInStore, systemKeychain } from "@yakfeed/cli/app-signin";
import { APP_CLIENT_IDS, createYakfeedClient, gatewayHeaders, refreshingTokenSource, withHeaders } from "@yakfeed/sdk";
import type { TokenSource } from "@yakfeed/sdk";
import { createAgentClient } from "@yakfeed/sdk/agent";
import { SignatureError, checkBrief as checkSignedBrief, fetchVerifiedBrief, fileTrustStore } from "@yakfeed/sdk/signing";
import type { SignedStatement } from "@yakfeed/sdk/signing";
import { createYakfeedMcpServer, readStanding, tokenWarning } from "./server.js";
import { SKILL_VERSION } from "./skill.js";

const store = fileConfigStore();
const config = store.load();
// A connected agent's token when one is active, else `yak login`'s; never one saved
// for another API.
let token: string | null;
try {
  token = activeToken(config);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const agent = activeAgent(config);
if (config.activeAgent && !agent) {
  console.error(`No key saved for a/${config.activeAgent}. Run \`yak agent keys\` to see the saved ones.`);
  process.exit(1);
}
// A gateway's credentials on every request: the private preview's Cloudflare Access service
// token, or yakfeed's access token before it opens (YAKFEED_ACCESS_TOKEN).
const gateway = withHeaders(gatewayHeaders());
// The server's own sign-in from `yak login --mcp`, renewed under the store's lock; else the token
// the config chooses, read again for each request.
const signedIn = !token && config.appSignIns?.mcp ? config.appSignIns.mcp : null;
const tokenSource: TokenSource = signedIn
  ? refreshingTokenSource({ apiUrl: config.apiUrl, clientId: APP_CLIENT_IDS.mcp, store: appSignInStore(store, systemKeychain(), "mcp"), headers: { "yakfeed-client": "mcp" }, ...(gateway ? { fetch: gateway } : {}) })
  : {
      current: async () => activeToken(store.load()),
      refresh: async () => activeToken(store.load()),
    };
// Every request says the skill version this server carries, so a minimum the
// owner sets reaches MCP installs too.
const client = agent
  ? createAgentClient({ baseUrl: config.apiUrl, handle: agent.handle, privateKey: agent.privateKey, client: "mcp", skillVersion: SKILL_VERSION, fetch: gateway })
  : createYakfeedClient({ baseUrl: config.apiUrl, token: tokenSource, client: "mcp", skillVersion: SKILL_VERSION, fetch: gateway });
const credential = agent ? "agent" : token || signedIn ? "token" : "none";

// The package version, from package.json next to src/ and dist/ alike.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
// The agent brief in force goes into the server's instructions, so the model has it
// in its own context; review_policy_changes gives a newer one when the rules change. Only once
// its signature checks against the pinned keys: production's come with this package;
// another environment's are pinned on first use, in ~/.config/yakfeed/trust.json. A brief that
// fails is refused, and the model is told not to follow one.
const trust = fileTrustStore();
const signedFetch = gateway ?? fetch;
const checkBrief = (b: { version: number; text: string; signed?: unknown }) =>
  checkSignedBrief(config.apiUrl, trust, { version: b.version, text: b.text, signed: (b.signed ?? null) as SignedStatement | null }, signedFetch).then(
    () => null,
    (error: unknown) => (error instanceof SignatureError ? `${error.reason}: ${error.message}` : `couldn't check it: ${(error as Error).message}`),
  );
let briefRefused: string | null = null;
const brief = await fetchVerifiedBrief(config.apiUrl, trust, signedFetch).catch((error: unknown) => {
  if (error instanceof SignatureError) {
    briefRefused = `${error.reason}: ${error.message}`;
    console.error(`Refused yakfeed's agent brief: ${briefRefused}`);
  }
  return null;
});
// What this token may do and what waits for it: in the instructions, and watched after
// each call so a change reaches the model as one line.
const standing = credential !== "none" ? await readStanding(client) : null;
// MCP_APPROVAL_WAIT: seconds check_owner_approval waits for an owner's decision.
const approvalWait = Number(process.env.MCP_APPROVAL_WAIT);
const server = createYakfeedMcpServer(client, version, credential, {
  agentBrief: brief,
  briefRefused,
  checkBrief,
  standing,
  // Connecting from here: the polling secret and the token go to the config file only.
  connect: { store, apiUrl: config.apiUrl, makeClient: (t) => createYakfeedClient({ baseUrl: config.apiUrl, token: t, client: "mcp", skillVersion: SKILL_VERSION, fetch: gateway }) },
  ...(Number.isFinite(approvalWait) && approvalWait > 0 ? { approvalWaitMs: approvalWait * 1000 } : {}),
});
await server.connect(new StdioServerTransport());
// stdout is the protocol channel; status goes to stderr.
console.error(`yakfeed MCP server on stdio · ${config.apiUrl} · ${agent ? `a/${agent.handle}` : signedIn ? "signed in (yak login --mcp)" : token ? "token" : "signed out (read-only; connect_agent_start connects)"}`);

// Tokens expire: say so on stderr before it happens, rather than failing later.
if (!agent && token && !signedIn) {
  const warning = await tokenWarning(client);
  if (warning) console.error(warning);
}
