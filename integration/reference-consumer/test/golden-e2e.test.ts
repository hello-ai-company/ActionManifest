import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DoclingAdapter } from "@actionmanifest/adapters";
import { extractActions } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";
import { classifyManifest } from "@actionmanifest/consumer";
import { exportIcs, exportJson } from "@actionmanifest/exporters";
import { validateActionManifest, type ActionManifest } from "@actionmanifest/core";

/**
 * Phase 2 Integration Golden Test.
 *
 * Synthetic Docling JSON (2-page school notice: event + rain alternative on
 * page 1, submit + prepare on page 2) flows through the whole public
 * contract: Adapter → CanonicalDocument → Extractor → Verifier → Consumer →
 * Exporters. Provenance (page/bbox/source identity) must survive every hop.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "../../../examples/docling-school-notice.json"), "utf8"),
) as Record<string, unknown>;

describe("Integration Golden E2E — Docling JSON to verified exports", () => {
  it("runs the full pipeline with provenance intact", async () => {
    // 1. Adapter → CanonicalDocument
    const doc = await new DoclingAdapter().toCanonical({ kind: "docling-json", payload: fixture });
    expect(doc.id).toBe("synthetic-autumn-excursion-notice");
    expect(doc.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.pages?.map((p) => p.pageNumber)).toEqual([1, 2]);

    // 2. Extractor → candidate manifest
    const candidate = await extractActions(doc);
    expect(candidate.source.id).toBe(doc.id);
    expect(candidate.source.hash).toBe(doc.sourceHash);

    const event = candidate.actions.find((a) => a.kind === "event");
    const submit = candidate.actions.find((a) => a.kind === "submit");
    const prepare = candidate.actions.find((a) => a.kind === "prepare");
    expect(event?.temporal?.date).toBe("2026-10-15");
    expect(submit?.temporal?.date).toBe("2026-10-05");
    expect(prepare).toBeDefined();

    // 3. Evidence provenance: page/bbox/source identity survive the adapter
    const eventEvidence = event?.evidence.find((e) => e.text.includes("秋の遠足を実施します"));
    expect(eventEvidence?.source_id).toBe(doc.id);
    expect(eventEvidence?.page).toBe(1);
    expect(eventEvidence?.bbox).toBeDefined();
    expect(eventEvidence?.section).toBe("保護者向け行事案内");

    const submitEvidence = submit?.evidence.find((e) => e.text.includes("参加確認票を提出"));
    expect(submitEvidence?.source_id).toBe(doc.id);
    expect(submitEvidence?.page).toBe(2);
    expect(submitEvidence?.bbox).toBeDefined();
    expect(submitEvidence?.bbox?.x).toBeCloseTo(72 / 612, 6);
    expect(submitEvidence?.section).toBe("提出物と持ち物");
    expect(submitEvidence?.source_reference).toBe("#/texts/4");

    const prepareEvidence = prepare?.evidence.find((e) => e.text.includes("持参してください"));
    expect(prepareEvidence?.page).toBe(2);
    expect(prepareEvidence?.section).toBe("提出物と持ち物");

    // 4. Rain date stays a conditional alternative, never the primary date
    expect(event?.temporal?.date).toBe("2026-10-15");
    const rain = event?.temporal?.alternatives?.find((a) => a.date === "2026-10-22");
    expect(rain?.type).toBe("conditional");
    expect(rain?.condition).toBe("雨天");

    // 5. Verifier → every expected action verified
    const { manifest, flags } = verifyManifest(candidate, doc);
    expect(flags.passed).toBe(true);
    expect(flags.verified_actions).toBe(candidate.actions.length);
    expect(manifest.actions.every((a) => a.status === "verified")).toBe(true);

    // 6. Consumer policy → everything ready, nothing blocked
    const report = classifyManifest(manifest);
    expect(report.manifestFatal).toBe(false);
    expect(report.counts.blocked).toBe(0);
    expect(report.counts.ready).toBe(candidate.actions.length);

    // 7. Exporters → primary event only in VEVENT; submit in VTODO
    const ics = exportIcs(manifest);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261015");
    expect(ics).not.toContain("DTSTART;VALUE=DATE:20261022");
    expect(ics).toContain("COMMENT:alternative 2026-10-22");
    expect(ics.match(/BEGIN:VTODO/g)).toHaveLength(1);
    expect(ics).toContain("DUE;VALUE=DATE:20261005");
    // prepare is relative ("当日") → unknown stays unknown, no VTODO for it
    expect(ics).not.toContain("持参");

    // 8. JSON export round-trips through schema validation
    const reparsed: ActionManifest = validateActionManifest(JSON.parse(exportJson(manifest)));
    expect(reparsed.actions).toHaveLength(candidate.actions.length);
    expect(reparsed.receipt?.verification?.passed).toBe(true);
  });
});
