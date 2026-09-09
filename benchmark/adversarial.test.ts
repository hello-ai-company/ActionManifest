import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtures, runBenchmark } from "../apps/cli/src/benchmark.js";
import {
  countDuplicateActions,
  evaluateForbidden,
  matchesForbidden,
  type ForbiddenPattern,
} from "../apps/cli/src/adversarial.js";
import type { Action } from "@actionmanifest/core";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const mkAction = (o: Partial<Action> & { id: string }): Action => ({
  kind: "submit",
  title: "提出する",
  modality: "required",
  actor: { certainty: "unknown" },
  evidence: [{ source_id: "d", text: "x" }],
  inference: "explicit",
  status: "proposed",
  ...o,
});

describe("adversarial corpus", () => {
  it("has 60+ total fixtures and 26+ adversarial fixtures across JP and EN", async () => {
    const fixtures = await loadFixtures(fixturesRoot);
    expect(fixtures.length).toBeGreaterThanOrEqual(60);
    const adversarial = fixtures.filter((f) => (f.meta.tags ?? []).includes("adversarial"));
    expect(adversarial.length).toBeGreaterThanOrEqual(26);
    expect(adversarial.filter((f) => f.meta.language === "ja").length).toBeGreaterThanOrEqual(16);
    expect(adversarial.filter((f) => f.meta.language === "en").length).toBeGreaterThanOrEqual(10);
  });

  it("has a non-empty Adversarial Golden Set", async () => {
    const fixtures = await loadFixtures(fixturesRoot);
    const advGolden = fixtures.filter((f) => f.meta.adversarialGolden);
    expect(advGolden.length).toBeGreaterThanOrEqual(5);
    expect(advGolden.length).toBeLessThanOrEqual(10);
  });

  it("every adversarial fixture carries negative expectations or is a discrimination case", async () => {
    const fixtures = await loadFixtures(fixturesRoot);
    const adversarial = fixtures.filter((f) => (f.meta.tags ?? []).includes("adversarial"));
    const withNegatives = adversarial.filter((f) => (f.expected.must_not_extract?.length ?? 0) > 0);
    // The majority of adversarial fixtures assert what must NOT be extracted.
    expect(withNegatives.length).toBeGreaterThanOrEqual(20);
  });

  it("SAFETY GATE: no critical false-verified action across the whole corpus", async () => {
    const { summary } = await runBenchmark(fixturesRoot);
    expect(summary.criticalFalseVerified).toBe(0);
    expect(summary.goldenPass).toBe(1);
    expect(summary.adversarialGoldenPass).toBe(1);
  });

  it("preserves corrections, negations and conditions (does not regress the existing Golden)", async () => {
    const { summary } = await runBenchmark(fixturesRoot);
    expect(Number(summary.correctionResolution)).toBe(1);
    expect(Number(summary.negationPreservation)).toBe(1);
    expect(Number(summary.conditionalPreservation)).toBe(1);
    expect(Number(summary.falseVerifiedActionRate)).toBe(0);
  });
});

describe("adversarial scoring primitives", () => {
  it("matches a forbidden pattern on date, including alternatives, and primaryDate only on primary", () => {
    const a = mkAction({
      id: "act_001",
      kind: "event",
      temporal: { type: "exact", date: "2026-10-12", raw_text: "x", alternatives: [{ type: "conditional", date: "2026-10-19", raw_text: "rain" }] },
    });
    expect(matchesForbidden(a, { date: "2026-10-19", failure: "WRONG_TEMPORAL", severity: "high" })).toBe(true);
    expect(matchesForbidden(a, { primaryDate: "2026-10-19", failure: "WRONG_TEMPORAL", severity: "high" })).toBe(false);
    expect(matchesForbidden(a, { primaryDate: "2026-10-12", failure: "WRONG_TEMPORAL", severity: "high" })).toBe(true);
  });

  it("unconditionalRequired matches only required actions with no conditions", () => {
    const withCond = mkAction({ id: "a", modality: "required", conditions: ["希望者のみ"] });
    const without = mkAction({ id: "b", modality: "required" });
    const p: ForbiddenPattern = { unconditionalRequired: true, failure: "CONDITION_LOST", severity: "high" };
    expect(matchesForbidden(withCond, p)).toBe(false);
    expect(matchesForbidden(without, p)).toBe(true);
  });

  it("counts a forbidden action as false-verified only when it is verified", () => {
    const extracted = [mkAction({ id: "act_001", kind: "event", temporal: { type: "exact", date: "2026-10-15", raw_text: "x" } })];
    const patterns: ForbiddenPattern[] = [{ date: "2026-10-15", failure: "SUPERSEDED_DATE", severity: "critical" }];
    const verified = evaluateForbidden(patterns, extracted, new Map([["act_001", true]]));
    expect(verified.forbiddenExtracted).toBe(1);
    expect(verified.forbiddenVerified).toBe(1);
    expect(verified.criticalFalseVerified).toBe(1);
    const notVerified = evaluateForbidden(patterns, extracted, new Map([["act_001", false]]));
    expect(notVerified.forbiddenExtracted).toBe(1);
    expect(notVerified.forbiddenVerified).toBe(0);
    expect(notVerified.criticalFalseVerified).toBe(0);
  });

  it("counts duplicate actions beyond the first", () => {
    const dup = [
      mkAction({ id: "a", kind: "submit", object: "確認票", temporal: { type: "exact", date: "2026-10-05", raw_text: "x" } }),
      mkAction({ id: "b", kind: "submit", object: "確認票", temporal: { type: "exact", date: "2026-10-05", raw_text: "y" } }),
      mkAction({ id: "c", kind: "prepare", object: "弁当" }),
    ];
    expect(countDuplicateActions(dup)).toBe(1);
  });
});
