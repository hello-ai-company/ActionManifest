import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtures, runBenchmark } from "../apps/cli/src/benchmark.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("benchmark fixtures", () => {
  it("has 20+ synthetic fixtures across JP and EN", async () => {
    const fixtures = await loadFixtures(fixturesRoot);
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
    expect(fixtures.some((f) => f.meta.language === "ja")).toBe(true);
    expect(fixtures.some((f) => f.meta.language === "en")).toBe(true);
    expect(fixtures.filter((f) => f.meta.golden)).toHaveLength(1);
  });

  it("golden fixture passes and hallucination/ambiguity metrics are defined", async () => {
    const { scores, summary } = await runBenchmark(fixturesRoot);
    const golden = scores.find((s) => s.golden);
    expect(golden?.goldenPass).toBe(true);
    expect(Number(summary.hallucinationRate)).toBeGreaterThanOrEqual(0);
    expect(Number(summary.ambiguityPreservation)).toBeGreaterThan(0);
    expect(scores.every((s) => s.evidenceMatch >= 0)).toBe(true);
  });
});
