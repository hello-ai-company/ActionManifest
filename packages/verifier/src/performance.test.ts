import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex, type ActionManifest, type CanonicalDocument } from "@actionmanifest/core";
import * as temporal from "@actionmanifest/temporal";
import { verifyAction, verifyManifest } from "./verify.js";

vi.mock("@actionmanifest/temporal", async importOriginal => {
  const actual = await importOriginal<typeof import("@actionmanifest/temporal")>();
  return { ...actual, parseTemporals: vi.fn(actual.parseTemporals), extractYearContext: vi.fn(actual.extractYearContext) };
});

function input(text = "2026年10月15日までに参加票を提出してください。", count = 40) {
  const hash = sha256Hex(text);
  const doc: CanonicalDocument = { id: "same-id", text, sourceHash: hash, pages: [{ pageNumber: 1, text }] };
  const manifest: ActionManifest = {
    schema_version: "0.2.0", source: { id: doc.id, hash },
    actions: Array.from({ length: count }, (_, i) => ({ id: `act_${i}`, kind: "submit", title: "参加票を提出する", modality: "required", actor: { certainty: "unknown" }, inference: "explicit", status: "proposed", evidence: [{ source_id: doc.id, page: 1, text }], temporal: { type: "exact", date: "2026-10-15", raw_text: "10月15日" } })),
  };
  return { doc, manifest };
}

beforeEach(() => vi.clearAllMocks());
describe("verification work scales per request, without shared trust state", () => {
  it("parses the source once, rather than once per action (deterministic performance regression)", () => {
    const { doc, manifest } = input();
    expect(verifyManifest(manifest, doc).flags.passed).toBe(true);
    expect(temporal.extractYearContext).toHaveBeenCalledTimes(1);
    expect(temporal.parseTemporals).toHaveBeenCalledTimes(manifest.actions.length + 1);
  });

  it("does not parse source dates at all when no action has an exact date", () => {
    const { doc, manifest } = input();
    for (const action of manifest.actions) delete action.temporal;
    expect(verifyManifest(manifest, doc).flags.passed).toBe(true);
    expect(temporal.parseTemporals).not.toHaveBeenCalled();
    expect(temporal.extractYearContext).not.toHaveBeenCalled();
  });

  it("matches standalone per-action results including invalid evidence/date/page/negation", () => {
    const { doc, manifest } = input(undefined, 4);
    manifest.actions[1]!.temporal!.date = "2026-10-16";
    manifest.actions[2]!.evidence[0]!.page = 2;
    manifest.actions[3]!.evidence[0]!.text = "参加票の提出は不要です。";
    const results = verifyManifest(manifest, doc).flags.actions;
    expect(results).toEqual(manifest.actions.map(action => verifyAction(action, doc, doc.text!, manifest)));
    expect(results?.map(result => result.passed)).toEqual([true, false, false, false]);
  });

  it("recomputes dates, quotes, pages and fatal hash state when the same document ID changes", () => {
    const { doc, manifest } = input(undefined, 1);
    expect(verifyManifest(manifest, doc).flags.passed).toBe(true);
    doc.text = "2027年11月20日に別の書類を提出してください。";
    doc.pages = [{ pageNumber: 2, text: doc.text }];
    doc.sourceHash = sha256Hex(doc.text);
    manifest.actions[0]!.evidence[0]!.text = doc.text;
    const next = verifyManifest(manifest, doc);
    expect(next.flags.source_hash_matched).toBe(false);
    expect(next.flags.actions?.[0]).toMatchObject({ evidence_supported: true, temporal_supported: false, page_refs_valid: false });
    expect(next.manifest.actions[0]?.status).toBe("proposed");
    manifest.schema_version = "0.3.0";
    expect(() => verifyManifest(manifest, doc)).toThrow(/Unsupported/);
  });
});
