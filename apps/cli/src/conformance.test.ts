import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultConformanceRoot, runConformance } from "./conformance.js";

const here = dirname(fileURLToPath(import.meta.url));
const suiteRoot = join(here, "../../../conformance");

describe("conformance suite", () => {
  it("locates the suite root", async () => {
    expect(await defaultConformanceRoot()).toBeTruthy();
  });

  it("reference implementation passes all official vectors", async () => {
    const report = await runConformance(suiteRoot);
    expect(report.failures).toEqual([]);
    expect(report.result).toBe("conformant");
    expect(report.critical_false_exported).toBe(0);
    expect(report.totals.total).toBeGreaterThanOrEqual(60);
    for (const p of Object.values(report.profiles)) {
      expect(p.passed).toBe(p.total);
    }
  });

  it("smoke run covers only the safety-critical profiles", async () => {
    const report = await runConformance(suiteRoot, { smoke: true });
    expect(Object.keys(report.profiles).sort()).toEqual(["ics", "trust"]);
    expect(report.result).toBe("conformant");
  });

  it("runner detects a deliberately failing vector (vectors are normative)", async () => {
    const root = mkdtempSync(join(tmpdir(), "conformance-neg-"));
    mkdirSync(join(root, "vectors", "trust"), { recursive: true });
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({
        suite: "actionmanifest-conformance",
        suite_version: "0.0.0-test",
        schema_versions: ["0.2.0"],
        profiles: ["trust"],
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
