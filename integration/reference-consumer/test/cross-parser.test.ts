import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DoclingAdapter } from "@actionmanifest/adapters";
import { XbergAdapter } from "@actionmanifest/adapter-xberg";
import type { ActionManifest, CanonicalDocument } from "@actionmanifest/core";
import { extractActions } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";
import { classifyManifest } from "@actionmanifest/consumer";
import { exportIcs, exportJson } from "@actionmanifest/exporters";

/**
 * Phase 2.2 cross-parser equivalence — the parser-independence proof.
 *
 * The SAME logical synthetic notice flows through two independent parsers
 * (Docling JSON fixture, Xberg ExtractionResult fixture). CanonicalDocuments
 * may differ in chunking/metadata/whitespace (never required to be
 * byte-identical); the SEMANTIC projections must be identical:
 * same Actions, same trust dispositions, same executable calendar semantics.
 *
 * Critical parser divergence (e.g. Docling says 10/15 while Xberg says
 * 10/22) MUST be 0.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

async function viaDocling() {
  const payload = loadJson("examples/docling-school-notice.json");
  const doc = await new DoclingAdapter().toCanonical({ kind: "docling-json", payload });
  return runPipeline(doc);
}

async function viaXberg() {
  const payload = loadJson("packages/adapter-xberg/fixtures/xberg-notice-elements.json");
  const doc = await new XbergAdapter().toCanonical({
    kind: "xberg-result",
    sourceId: "xberg-notice",
    payload,
  });
  return runPipeline(doc);
}

async function runPipeline(doc: CanonicalDocument) {
  const candidate = await extractActions(doc);
  const { manifest, flags } = verifyManifest(candidate, doc);
  const report = classifyManifest(manifest);
  return { doc, manifest, flags, report, ics: exportIcs(manifest), json: exportJson(manifest) };
}

/** Semantic projection: parser-independent view of an Action set. */
function actionProjection(manifest: ActionManifest) {
  return manifest.actions
    .map((a) => ({
      kind: a.kind,
      modality: a.modality,
      date: a.temporal?.date ?? null,
      alternatives: (a.temporal?.alternatives ?? []).map((t) => t.date ?? null).sort(),
    }))
    .sort((a, b) => `${a.kind}:${a.date}`.localeCompare(`${b.kind}:${b.date}`));
}

function dispositionProjection(report: ReturnType<typeof classifyManifest>) {
  return report.actions.map((a) => a.disposition).sort();
}

function calendarDates(ics: string): string[] {
  return [...ics.matchAll(/^(?:DTSTART|DUE);VALUE=DATE:(\d+)$/gm)].map((m) => m[1]!).sort();
}

describe("cross-parser equivalence (Docling vs Xberg)", () => {
  it("produces identical semantic Actions, trust, and calendar projections", async () => {
    const d = await viaDocling();
    const x = await viaXberg();

    // Same semantic Actions
    expect(actionProjection(x.manifest)).toEqual(actionProjection(d.manifest));
    // Same trust dispositions (all ready)
    expect(dispositionProjection(x.report)).toEqual(dispositionProjection(d.report));
    expect(x.report.counts.ready).toBe(d.report.counts.ready);
    expect(x.report.counts.blocked).toBe(0);
    // Same executable calendar semantics
    expect(calendarDates(x.ics)).toEqual(calendarDates(d.ics));
    expect(calendarDates(x.ics)).toEqual(["20261005", "20261015"]);

    // Conditional rain date stays non-executable on both paths
    for (const ics of [d.ics, x.ics]) {
      expect(ics).not.toContain("DTSTART;VALUE=DATE:20261022");
      expect(ics).toContain("COMMENT:alternative 2026-10-22");
    }

    // JSON exports are schema-valid on both paths
    expect(JSON.parse(d.json).actions.length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(x.json).actions.length).toBeGreaterThanOrEqual(3);
  });

  it("critical parser divergence = 0 (event date, submit deadline, prepare, rain alternative)", async () => {
    const d = await viaDocling();
    const x = await viaXberg();

    const criticalOf = (m: ActionManifest) => ({
      eventDate: m.actions.find((a) => a.kind === "event")?.temporal?.date ?? null,
      submitDue: m.actions.find((a) => a.kind === "submit")?.temporal?.date ?? null,
      hasPrepare: m.actions.some((a) => a.kind === "prepare"),
      rainAlternative:
        m.actions
          .find((a) => a.kind === "event")
          ?.temporal?.alternatives?.some((t) => t.date === "2026-10-22" && t.type === "conditional") ??
        false,
    });
    const dc = criticalOf(d.manifest);
    const xc = criticalOf(x.manifest);
    expect(xc).toEqual(dc);
    expect(dc).toEqual({
      eventDate: "2026-10-15",
      submitDue: "2026-10-05",
      hasPrepare: true,
      rainAlternative: true,
    });
  });

  it("evidence provenance is source-specific but valid on both paths", async () => {
    const d = await viaDocling();
    const x = await viaXberg();

    // Docling path: page-level provenance exists (2-page PDF-like fixture)
    const dSubmit = d.manifest.actions.find((a) => a.kind === "submit")!;
    expect(dSubmit.evidence[0]?.page).toBe(2);
    expect(dSubmit.evidence[0]?.bbox).toBeDefined();

    // Xberg path: markdown fixture has no pages — provenance is section +
    // sourceReference, and NO page/bbox is invented.
    const xSubmit = x.manifest.actions.find((a) => a.kind === "submit")!;
    expect(xSubmit.evidence[0]?.page).toBeUndefined();
    expect(xSubmit.evidence[0]?.bbox).toBeUndefined();
    expect(xSubmit.evidence[0]?.section).toBe("提出物");
    expect(xSubmit.evidence[0]?.source_reference).toMatch(/^elem-/);

    // Both verify clean
    expect(d.flags.passed).toBe(true);
    expect(x.flags.passed).toBe(true);
  });
});
