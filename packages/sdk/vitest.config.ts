import { defineConfig } from "vitest/config";

// Its own cache folder: without one, packages without a vitest config share one at the repo
// root, and `pnpm test` runs them in parallel, so they could clear it under each other (ENOTEMPTY).
export default defineConfig({ cacheDir: "node_modules/.vite" });
