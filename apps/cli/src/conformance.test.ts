import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultConformanceRoot, runConformance } from "./conformance.js";
import { ConformanceConfigError } from "./conformance-validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const suiteRoot = join(here, "../../../conformance");

describe("conformance suite", () => {
  it("locates the suite root", async () => {
    expect(await defaultConformanceRoot()).toBeTruthy();
  });

  it("reference implementation passes all official universal vectors", async () => {
    const report = await runConformance(suiteRoot);
    expect(report.failures).toEqual([]);
    expect(report.result).toBe("conformant");
    expect(report.scope).toBe("universal");
    expect(report.critical_false_exported).toBe(0);
    expect(report.totals.total).toBeGreaterThanOrEqual(60);
    // Universal conformance never includes reference-serialization.
    expect(report.profiles["reference-serialization"]).toBeUndefined();
    expect(report.reference_serialization).toBeUndefined();
    for (const p of Object.values(report.profiles)) {
      expect(p.passed).toBe(p.total);
    }
  });

  it("--reference adds byte-exact serialization regression as a SEPARATE result", async () => {
    const report = await runConformance(suiteRoot, { reference: true });
    expect(report.scope).toBe("universal+reference");
    expect(report.result).toBe("conformant");
    expect(report.reference_serialization).toBeDefined();
    expect(report.reference_serialization!.total).toBeGreaterThanOrEqual(4);
    expect(report.reference_serialization!.passed).toBe(
      report.reference_serialization!.total,
    );
  });

  it("smoke run covers only the safety-critical profiles", async () => {
    const report = await runConformance(suiteRoot, { smoke: true });
    expect(Object.keys(report.profiles).sort()).toEqual(["ics", "trust"]);
    expect(report.result).toBe("conformant");
  });

  it("a malformed vector is a runner/config error (never silently ignored)", async () => {
    const root = mkdtempSync(join(tmpdir(), "conformance-bad-"));
    mkdirSync(join(root, "vectors", "trust"), { recursive: true });
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({
        suite: "actionmanifest-conformance",
        suite_version: "0.0.0-test",
        schema_versions: ["0.2.0"],
        profiles: ["trust"],
        reference_profiles: [],
        smoke_profiles: [],
      }),
    );
    // Typo'd expectation field: "reasn" instead of "reason".
    writeFileSync(
      join(root, "vectors", "trust", "typo-001.json"),
      JSON.stringify({
        id: "typo-001",
        profile: "trust",
        input: { action: { id: "act_001" }, verification: null },
        expected: {
          ready: false,
          reasn: "VERIFICATION_MISSING",
          disposition: "review_required",
          exportable_default: false,
        },
      }),
    );
    await expect(runConformance(root)).rejects.toBeInstanceOf(ConformanceConfigError);
  });

  it("runner detects a deliberately failing vector (vectors are normative)", async () => {
    const root = mkdtempSync(join(tmpdir(), "conformance-neg-"));
    mkdirSync(join(root, "vectors", "trust"), { recursive: true });
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({
        suite: "actionmanifest-conformance",
        suite_version: "0.0.0",
        schema_versions: ["0.2.0"],
        profiles: ["trust"],
        reference_profiles: [],
        smoke_profiles: [],
      }),
    );
    // Normative expectation: a failed per-action receipt means NOT exportable.
    // (If the implementation ever regresses, this vector must fail.)
    writeFileSync(
      join(root, "vectors", "trust", "neg-001.json"),
      JSON.stringify({
        id: "neg-001",
        profile: "trust",
        input: {
          action: {
            id: "act_001",
            kind: "submit",
            title: "x",
            modality: "required",
            actor: { certainty: "unknown" },
            evidence: [{ source_id: "conf", text: "q" }],
            inference: "explicit",
            status: "verified",
          },
          verification: {
            evidence_supported: true,
            temporal_supported: false,
            actor_supported: true,
            modality_supported: true,
            source_hash_matched: true,
            negation_conflict: false,
            page_refs_valid: true,
            passed: false,
            actions: [
              {
                action_id: "act_001",
                passed: false,
                evidence_supported: true,
                temporal_supported: false,
                actor_supported: true,
                modality_supported: true,
                negation_conflict: false,
                page_refs_valid: true,
                issues: [{ code: "TEMPORAL_UNSUPPORTED", message: "x" }],
              },
            ],
          },
        },
        expected: {
          ready: false,
          reason: "VERIFICATION_FAILED",
          disposition: "blocked",
          exportable_default: false,
        },
      }),
    );
    const report = await runConformance(root);
    expect(report.result).toBe("conformant");
    expect(report.totals).toEqual({ passed: 1, total: 1 });
  });
});
