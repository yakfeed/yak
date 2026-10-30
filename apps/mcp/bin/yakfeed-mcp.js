#!/usr/bin/env node
// For working on yakfeed itself: runs the TypeScript sources, against the local API unless
// YAK_API_URL or a saved config says otherwise. The published package runs dist/main.js,
// which defaults to the production API.
// stdout carries the MCP protocol, so nothing else may write to it.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const tsx = require.resolve("tsx/cli");
const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const env = { YAK_DEFAULT_API_URL: "http://localhost:3000", ...process.env };
const result = spawnSync(process.execPath, [tsx, main, ...process.argv.slice(2)], { stdio: "inherit", env });
process.exit(result.status ?? 1);
