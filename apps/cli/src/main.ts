#!/usr/bin/env node
import { createInterface } from "node:readline";
import { run } from "./commands.js";
import { fileConfigStore } from "./config.js";
import { terminalOutput } from "./format.js";
import { readSecret } from "./secret.js";

/** Asks at the terminal; absent when there's none (pipes, CI), so commands say to pass --yes. */
function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

process.exitCode = await run(process.argv.slice(2), {
  store: fileConfigStore(),
  out: terminalOutput(),
  readSecret: (q) => readSecret(q),
  stdinIsTTY: process.stdin.isTTY === true,
  ...(process.stdin.isTTY ? { ask } : {}),
});
