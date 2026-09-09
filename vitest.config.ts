import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@actionmanifest/schema": join(root, "packages/schema/src/index.ts"),
      "@actionmanifest/core": join(root, "packages/core/src/index.ts"),
      "@actionmanifest/adapters": join(root, "packages/adapters/src/index.ts"),
      "@actionmanifest/temporal": join(root, "packages/temporal/src/index.ts"),
      "@actionmanifest/extractor": join(root, "packages/extractor/src/index.ts"),
      "@actionmanifest/verifier": join(root, "packages/verifier/src/index.ts"),
      "@actionmanifest/exporters": join(root, "packages/exporters/src/index.ts"),
    },
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "benchmark/**/*.test.ts",
    ],
    environment: "node",
    reporters: ["default"],
  },
});
