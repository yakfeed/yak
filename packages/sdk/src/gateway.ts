// A gateway in front of the API, such as Cloudflare Access on the private preview
// (infra/home/README.md, "Agents and yak"), or yakfeed's own access gate before it opens to
// everyone, wants its own credentials on every request.

type Env = Record<string, string | undefined>;
const processEnv = (): Env => (globalThis as { process?: { env: Env } }).process?.env ?? {};

/** Cloudflare Access service token, from the environment's CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET. */
export function cloudflareAccessHeaders(env: Env = processEnv()): Record<string, string> {
  const id = env.CF_ACCESS_CLIENT_ID;
  const secret = env.CF_ACCESS_CLIENT_SECRET;
  return id && secret ? { "cf-access-client-id": id, "cf-access-client-secret": secret } : {};
}

/**
 * yakfeed's access token, from the environment's YAKFEED_ACCESS_TOKEN: before yakfeed opens to
 * everyone, it lets a program that can't come from an invited address past the gate. It gets
 * past the gate only, never into an account: the API still wants its own token.
 */
export function yakfeedAccessHeaders(env: Env = processEnv()): Record<string, string> {
  const token = env.YAKFEED_ACCESS_TOKEN?.trim();
  return token ? { "x-yakfeed-access": token } : {};
}

/** Every gateway credential the environment holds: Cloudflare Access's and yakfeed's access token. */
export function gatewayHeaders(env: Env = processEnv()): Record<string, string> {
  return { ...cloudflareAccessHeaders(env), ...yakfeedAccessHeaders(env) };
}

/** A fetch that adds these headers to every request; the given fetch itself when there are none. */
export function withHeaders(headers: Record<string, string>, base: typeof fetch = fetch): typeof fetch {
  if (Object.keys(headers).length === 0) return base;
  return (input, init) => {
    const request = new Request(input, init);
    const merged = new Headers(request.headers);
    for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    return base(new Request(request, { headers: merged }));
  };
}
