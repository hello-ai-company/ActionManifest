import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function mkdirSyncSafe(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
import {
  MIN_DETERMINISTIC_PNPM,
  dependencyKeyOrder,
  distinctHashCounts,
  semverAtLeast,
} from "./release-reproducibility.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("release-reproducibility helpers (pure)", () => {
  it("semverAtLeast compares correctly", () => {
    expect(semverAtLeast("11.23.0", "11.23.0")).toBe(true);
    expect(semverAtLeast("11.23.1", "11.23.0")).toBe(true);
    expect(semverAtLeast("12.0.0", "11.23.0")).toBe(true);
    expect(semverAtLeast("10.14.0", "11.23.0")).toBe(false);
    expect(semverAtLeast("11.22.9", "11.23.0")).toBe(false);
  });

  it("distinctHashCounts reports unique hash counts per package", () => {
    const counts = distinctHashCounts(
      new Map([
        ["@actionmanifest/cli", ["a", "a", "a"]],
        ["@actionmanifest/core", ["a", "b"]],
      ]),
    );
    expect(counts.get("@actionmanifest/cli")).toBe(1);
    expect(counts.get("@actionmanifest/core")).toBe(2);
  });

  it("dependencyKeyOrder preserves the JSON insertion order", () => {
    const order = dependencyKeyOrder(
      JSON.stringify({ dependencies: { b: "1", a: "2", c: "3" } }),
    );
    expect(order).toEqual(["b", "a", "c"]);
  });

  it("the running pnpm satisfies the deterministic-pack minimum", () => {
    const v = execFileSync("pnpm", ["--version"], { cwd: root, encoding: "utf8" }).trim();
    expect(semverAtLeast(v, MIN_DETERMINISTIC_PNPM)).toBe(true);
  });
});

describe("packed manifest dependency order stability (regression: pnpm#10167)", () => {
  it("extractor and cli pack identical dependency key order across runs", { timeout: 120_000 }, () => {
    const work = mkdtempSync(join(tmpdir(), "repro-test-"));
    try {
      const extractorOrders: string[][] = [];
      const cliOrders: string[][] = [];
      for (const runDir of ["a", "b"]) {
        const outDir = join(work, runDir);
        mkdirSyncSafe(outDir);
        for (const pkgDir of ["packages/extractor", "apps/cli"]) {
          execFileSync("pnpm", ["pack", "--pack-destination", outDir], {
            cwd: join(root, pkgDir),
            stdio: ["ignore", "pipe", "pipe"],
          });
        }
        for (const file of readdirSync(outDir).filter((f) => f.endsWith(".tgz"))) {
          const manifest = execFileSync("tar", ["-xzf", join(outDir, file), "-O", "package/package.json"], {
            encoding: "utf8",
          });
          const order = dependencyKeyOrder(manifest);
          if (file.includes("extractor")) extractorOrders.push(order);
          else if (file.includes("cli")) cliOrders.push(order);
        }
      }
      expect(extractorOrders).toHaveLength(2);
      expect(cliOrders).toHaveLength(2);
      expect(extractorOrders[0]).toEqual(extractorOrders[1]);
      expect(cliOrders[0]).toEqual(cliOrders[1]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
