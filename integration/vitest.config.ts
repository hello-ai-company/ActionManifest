import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Integration tests intentionally resolve `@actionmanifest/*` through each
 * package's package.json `exports` — i.e. the BUILT dist, exactly like a
 * third-party consumer of the published packages. There are deliberately NO
 * source aliases here (the root vitest.config.ts has them; this config does
 * not). Run after `pnpm build` (the `integration:test` script does).
 */
export default defineConfig({
  root,
  test: {
    include: [join(root, "**/*.test.ts")],
    environment: "node",
    reporters: ["default"],
  },
});
