import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import noInlineTunable from "./tools/eslint-rules/no-inline-tunable.mjs";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/build/**", "**/.svelte-kit/**", "**/node_modules/**", "**/db/migrations/**", "**/schema.d.ts", "**/playwright-report/**", "**/test-results/**", ".claude/worktrees/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Tunables come from settings. Older occurrences are in eslint-suppressions.json,
  // which may only shrink: lint fails on a suppression nothing needs any more (prune it with
  // `pnpm exec eslint . --prune-suppressions`).
  {
    files: ["apps/{api,cli,mcp,web}/src/**/*.ts", "packages/sdk/src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.contract.ts", "apps/api/src/settings.ts", "apps/api/src/config.ts", "apps/web/src/lib/server/settings.ts"],
    plugins: { yakfeed: { rules: { "no-inline-tunable": noInlineTunable } } },
    rules: { "yakfeed/no-inline-tunable": "error" },
  },
);
