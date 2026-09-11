import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Opt-in live-runtime tests for the Xberg native binding. Not part of the
 * default `pnpm test` run (native binaries are platform-dependent); run
 * explicitly with `pnpm xberg:integration`. Requires Node >= 22 (the
 * adapter-xberg engines floor). Toolchain CI is Node 22+; Node 20 consumer
 * proof excludes this package. Release Check also gates native smoke on
 * the canonical artifact.
 * Offline inputs only (local files / bytes) — no network.
 */
export default defineConfig({
  root,
  test: {
    include: [join(root, "src/**/*.integration.test.ts")],
    environment: "node",
    testTimeout: 60_000,
  },
});

