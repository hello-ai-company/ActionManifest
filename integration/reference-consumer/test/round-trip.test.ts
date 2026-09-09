import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PlainTextAdapter } from "@actionmanifest/adapters";
import {
  ExportError,
  SCHEMA_VERSION,
  validateActionManifest,
  type ActionManifest,
} from "@actionmanifest/core";
import { exportIcs, exportJson } from "@actionmanifest/exporters";
import { verifyManifest } from "@actionmanifest/verifier";
import { consumeDoclingJson, consumePlainText } from "../src/reference-consumer.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "../../../examples");

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(examples, name), "utf8"));
}

const GOLDEN_TEXT = readFileSync(join(examples, "golden-excursion.txt"), "utf8");

describe("A: plain text → CanonicalDocument → ActionManifest → verify → JSON", () => {
  it("round-trips through the public packages only", async () => {
    const result = await consumePlainText(GOLDEN_TEXT, "school-golden-excursion");
    expect(result.report.manifestFatal).toBe(false);
    expect(result.ready.length).toBeGreaterThanOrEqual(3);

    // The exported JSON is a schema-valid manifest (round-trip fidelity).
    const reparsed = validateActionManifest(JSON.parse(result.json));
    expect(reparsed.schema_version).toBe(SCHEMA_VERSION);
    expect(reparsed.source.id).toBe("school-golden-excursion");
    expect(reparsed.source.hash).toBe(result.doc.sourceHash);
    expect(reparsed.actions.every((a) => a.status === "verified")).toBe(true);
  });
});

describe("B: Docling JSON → CanonicalDocument → ActionManifest → verify → JSON", () => {
  it("round-trips through the public packages only", async () => {
    const result = await consumeDoclingJson(loadJson("docling-school-notice.json"));
    expect(result.report.manifestFatal).toBe(false);
    expect(result.ready.length).toBeGreaterThanOrEqual(3);

    const reparsed = validateActionManifest(JSON.parse(result.json));
    expect(reparsed.source.id).toBe("synthetic-autumn-excursion-notice");
    expect(reparsed.actions.every((a) => a.status === "verified")).toBe(true);
  });
});

describe("C/D: verified actions → ICS artifacts", () => {
  it("verified event becomes a VEVENT with the exact date", async () => {
    const result = await consumePlainText(GOLDEN_TEXT, "school-golden-excursion");
    expect(result.ics).toContain("BEGIN:VEVENT");
    expect(result.ics).toContain("DTSTART;VALUE=DATE:20261015");
  });

  it("verified submit becomes a VTODO with DUE", async () => {
    const result = await consumePlainText(GOLDEN_TEXT, "school-golden-excursion");
    expect(result.ics).toContain("BEGIN:VTODO");
    expect(result.ics).toContain("DUE;VALUE=DATE:20261005");
  });
});

describe("E: unverified actions are excluded by the default export policy", () => {
  it("a hallucinated action is not exported to ICS or default JSON", async () => {
    const adapter = new PlainTextAdapter();
    const doc = await adapter.toCanonical({
      kind: "text",
      id: "mixed",
      text: "令和8年10月15日に秋の遠足を実施します。\n健康診断は10月頃の予定です。",
    });
    const candidate: ActionManifest = {
      schema_version: SCHEMA_VERSION,
      source: { id: doc.id, hash: doc.sourceHash },
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "秋の遠足を実施する",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: { type: "exact", date: "2026-10-15", raw_text: "令和8年10月15日" },
          evidence: [{ source_id: doc.id, text: "令和8年10月15日に秋の遠足を実施します。" }],
          inference: "explicit",
          status: "proposed",
        },
        {
          id: "act_002",
          kind: "deadline",
          title: "健康診断の締切(捏造)",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: { type: "exact", date: "2026-10-01", raw_text: "10月頃" },
          evidence: [{ source_id: doc.id, text: "健康診断は10月頃の予定です。" }],
          inference: "explicit",
          status: "proposed",
        },
      ],
    };
    const { manifest } = verifyManifest(candidate, doc);
    const bad = manifest.actions.find((a) => a.id === "act_002");
    expect(bad?.status).toBe("proposed"); // failed verification → not promoted

    const ics = exportIcs(manifest);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261015");
    expect(ics).not.toContain("20261001");
    expect(ics).not.toContain("健康診断の締切");

    const defaultJson = JSON.parse(exportJson(manifest)) as ActionManifest;
    expect(defaultJson.actions.map((a) => a.id)).toEqual(["act_001"]);

    const auditJson = JSON.parse(exportJson(manifest, { include: "all" })) as ActionManifest;
    expect(auditJson.actions).toHaveLength(2);
  });
});

describe("F: manifest-level fatal → no executable output", () => {
  it("exporters throw ExportError when the source hash does not match", async () => {
    const adapter = new PlainTextAdapter();
    const doc = await adapter.toCanonical({ kind: "text", id: "doc-a", text: "令和8年10月15日に秋の遠足を実施します。" });
    const otherDoc = await adapter.toCanonical({ kind: "text", id: "doc-b", text: "まったく別の文書です。" });

    const candidate: ActionManifest = {
      schema_version: SCHEMA_VERSION,
      source: { id: doc.id, hash: doc.sourceHash },
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "秋の遠足を実施する",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: { type: "exact", date: "2026-10-15", raw_text: "令和8年10月15日" },
          evidence: [{ source_id: doc.id, text: "令和8年10月15日に秋の遠足を実施します。" }],
          inference: "explicit",
          status: "proposed",
        },
      ],
    };
    // Verify against a DIFFERENT document → manifest-level fatal (hash mismatch).
    const { manifest, flags } = verifyManifest(candidate, otherDoc);
    expect(flags.source_hash_matched).toBe(false);
    expect(flags.verified_actions).toBe(0);

    expect(() => exportIcs(manifest)).toThrowError(ExportError);
    expect(() => exportJson(manifest)).toThrowError(ExportError);
  });
});
