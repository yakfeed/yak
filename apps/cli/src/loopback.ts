// The loopback redirect for `yak login` (RFC 8252 section 7.3): a listener on 127.0.0.1 on a port
// the system picks, for the one request the browser makes back after the person confirms on the
// website. It answers with a plain page saying what happened, and nothing else. A request whose
// `state` isn't this sign-in's gets a 400 and the listener keeps waiting (RFC 8252 section 8.1):
// another program on this machine can't end the sign-in by calling first.
import { createServer } from "node:http";

export interface Loopback {
  /** `http://127.0.0.1:<port><path>`: what the authorization request names. */
  redirectUri: string;
  /** The URL the browser came back to with this sign-in's `state`, with its `code` (or `error`). */
  result: Promise<URL>;
  /** The `state` the authorization request carries: until it's set, every callback gets a 400. */
  expect(state: string): void;
  close(): void;
}

export type LoopbackWait = (options: { path: string; timeoutMs: number }) => Promise<Loopback>;

const page = (title: string, text: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head>` +
  `<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem"><h1 style="font-size: 1.2rem">${title}</h1><p>${text}</p></body></html>`;

export const waitForLoopback: LoopbackWait = ({ path, timeoutMs }) =>
  new Promise((ready, failed) => {
    let settle: (url: URL) => void = () => undefined;
    let expected: string | null = null;
    let fail: (error: Error) => void = () => undefined;
    const result = new Promise<URL>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    // Nobody waits on it until the browser opens; a rejection meanwhile isn't unhandled.
    result.catch(() => undefined);
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== path) {
        res.writeHead(404, { "content-type": "text/plain" }).end("Not here.");
        return;
      }
      if (expected === null || url.searchParams.get("state") !== expected) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page("Not this sign-in", "This doesn't match the sign-in yak is waiting for. Nothing changed."));
        return;
      }
      const ok = url.searchParams.has("code");
      // The code never leaves this machine's memory: no referrer, nothing cached.
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer", "cache-control": "no-store" })
        .end(ok ? page("Signed in", "yak has the sign-in. You can close this tab and go back to your terminal.") : page("Not signed in", "Nothing was signed in. Go back to your terminal to see why."));
      settle(url);
    });
    const timer = setTimeout(() => fail(new Error("Nobody came back from the browser in time. Run yak login again, or yak login --device.")), timeoutMs);
    timer.unref();
    server.on("error", failed);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      ready({
        redirectUri: `http://127.0.0.1:${port}${path}`,
        result,
        expect: (state) => {
          expected = state;
        },
        close: () => {
          clearTimeout(timer);
          server.close();
          server.closeAllConnections();
        },
      });
    });
  });
