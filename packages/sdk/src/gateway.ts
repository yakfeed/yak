// A gateway in front of the API, such as Cloudflare Access on the private preview
// (infra/home/README.md, "Agents and yak"), wants its own credentials on every request.

/** Cloudflare Access service token, from the environment's CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET. */
export function cloudflareAccessHeaders(env: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}): Record<string, string> {
  const id = env.CF_ACCESS_CLIENT_ID;
  const secret = env.CF_ACCESS_CLIENT_SECRET;
  return id && secret ? { "cf-access-client-id": id, "cf-access-client-secret": secret } : {};
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
