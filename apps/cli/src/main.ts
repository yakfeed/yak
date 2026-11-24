#!/usr/bin/env node
import { ask } from "./ask.js";
import { run } from "./commands.js";
import { fileConfigStore } from "./config.js";
import { terminalOutput } from "./format.js";
import { readSecret } from "./secret.js";

process.exitCode = await run(process.argv.slice(2), {
  store: fileConfigStore(),
  out: terminalOutput(),
  readSecret: (q) => readSecret(q),
  stdinIsTTY: process.stdin.isTTY === true,
  // Absent when there's no terminal (pipes, CI), so commands say to pass --yes.
  ...(process.stdin.isTTY ? { ask: (q: string) => ask(q) } : {}),
});
