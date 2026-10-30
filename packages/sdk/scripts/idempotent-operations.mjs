// Writes src/idempotent-operations.ts from openapi.json: every operation that takes an
// Idempotency-Key, which the client sends a key on and may retry. Run by
// `pnpm --filter @yakfeed/sdk generate` (and so `pnpm sdk`). Optional arguments: the spec to read
// and the file to write (the API's openapi-drift.test.ts writes to a temporary folder and compares).
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const [specPath, outPath] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specPath ?? new URL("openapi.json", root), "utf8"));
const operations = [];
for (const [path, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    if ((op.parameters ?? []).some((p) => p.in === "header" && p.name === "idempotency-key")) operations.push(`${method.toUpperCase()} ${path}`);
  }
}
operations.sort();
const body = `// Generated from openapi.json by scripts/idempotent-operations.mjs: don't edit by hand.
// The operations that take an Idempotency-Key.
export const IDEMPOTENT_OPERATIONS: readonly string[] = [
${operations.map((o) => `  ${JSON.stringify(o)},`).join("\n")}
];
`;
writeFileSync(outPath ?? new URL("src/idempotent-operations.ts", root), body);
