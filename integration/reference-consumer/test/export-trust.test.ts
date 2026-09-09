import { describe, expect, it } from "vitest";

import {
  ExportError,
  SCHEMA_VERSION,
  type Action,
  type ActionManifest,
  type ActionVerificationResult,
  type VerificationFlags,
} from "@actionmanifest/core";
import { classifyManifest } from "@actionmanifest/consumer";
import { exportIcs, exportJson } from "@actionmanifest/exporters";
import { consumePlainText } from "../src/reference-consumer.js";

/**
 * Pre-merge hardening integration tests (G–K): consumer and exporter must
 * share ONE trust model, conditional temporals must never become executable
 * dates, and ICS UIDs must be globally stable and opaque.
 */

function makeAction(partial: Partial<Action> & Pick<Action, "id" | "kind" | "title">): Action {
  return {
    modality: "required",
    actor: { certainty: "unknown" },
    evidence: [{ source_id: "s", text: "quote" }],
    inference: "explicit",
    status: "proposed",
    ...partial,
  };
}

function perAction(id: string, passed: boolean): ActionVerificationResult {
  return {
    action_id: id,
    passed,
    evidence_supported: passed,
    temporal_supported: passed,
    actor_supported: true,
    modality_supported: true,
    negation_conflict: false,
    page_refs_valid: true,
    issues: passed
      ? []
      : [{ code: "TEMPORAL_UNSUPPORTED", message: "declared date not in evidence", action_id: id }],
  };
}

function manifestWith(
  actions: Action[],
  verification?: Partial<VerificationFlags>,
  sourceId = "s",
): ActionManifest {
  return {
    schema_version: SCHEMA_VERSION,
    source: { id: sourceId, hash: "abc" },
    actions,
    ...(verification
      ? {
          receipt: {
            extraction: {
              provider: "t",
              model: "t",
              extractor_version: "0",
              schema_version: SCHEMA_VERSION,
              created_at: "t",
            },
            verification: {
              evidence_supported: true,
              temporal_supported: true,
              actor_supported: true,
              modality_supported: true,
              source_hash_matched: true,
              negation_conflict: false,
              page_refs_valid: true,
              passed: true,
              ...verification,
            },
          },
        }
      : {}),
  };
}

const datedEvent = (id: string, status: Action["status"]) =>
  makeAction({
    id,
    kind: "event",
    title: `event ${id}`,
    status,
    temporal: { type: "exact", date: "2026-10-15", raw_text: "10月15日" },
  });

function uids(ics: string): string[] {
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  return [...unfolded.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]!);
}

describe("G: status/receipt contradiction — consumer and exporter agree", () => {
  it("status=verified + per-action passed=false → consumer blocked, default export excludes", () => {
    const m = manifestWith(
      [datedEvent("act_001", "verified")],
      { passed: false, temporal_supported: false, actions: [perAction("act_001", false)] },
    );
    const report = classifyManifest(m);
    expect(report.actions[0]?.disposition).toBe("blocked");
    expect(JSON.parse(exportJson(m)).actions).toHaveLength(0);
    expect(exportIcs(m)).not.toContain("BEGIN:VEVENT");
    // include:all keeps it for audit, explicitly marked as blocked
    const ics = exportIcs(m, { include: "all" });
    expect(ics).toContain("X-ACTIONMANIFEST-STATUS:verified");
    expect(ics).toContain("X-ACTIONMANIFEST-DISPOSITION:blocked");
  });
});

describe("H: verification missing with verified status", () => {
  it("consumer review_required, default export excludes", () => {
    const m = manifestWith([datedEvent("act_001", "verified")]);
    const report = classifyManifest(m);
    expect(report.actions[0]?.disposition).toBe("review_required");
    expect(report.actions[0]?.reasons.map((r) => r.code)).toContain("VERIFICATION_MISSING");
    expect(JSON.parse(exportJson(m)).actions).toHaveLength(0);
    expect(exportIcs(m)).not.toContain("BEGIN:VEVENT");
  });
});

describe("I: top-level conditional event is not executable", () => {
  it("conditional-only event produces no VEVENT/DTSTART; fatal-free manifest stays exportable", () => {
    const m = manifestWith(
      [
        makeAction({
          id: "act_001",
          kind: "event",
          title: "雨天時の代替日",
          status: "verified",
          temporal: {
            type: "conditional",
            date: "2026-10-22",
            raw_text: "雨天の場合は10月22日に延期します",
            condition: "雨天",
          },
        }),
      ],
      { actions: [perAction("act_001", true)] },
    );
    // The Action itself is trustworthy (verified) — but a conditional date is
    // information, not an executable calendar entry.
    expect(classifyManifest(m).actions[0]?.disposition).toBe("ready");
    const ics = exportIcs(m);
    expect(ics).not.toContain("DTSTART");
    expect(ics).not.toContain("BEGIN:VEVENT");
    expect(ics).toContain("BEGIN:VCALENDAR");
  });
});

describe("J: top-level conditional todo is not executable", () => {
  it("conditional-only submit produces no VTODO/DUE", () => {
    const m = manifestWith(
      [
        makeAction({
          id: "act_001",
          kind: "submit",
          title: "条件付き提出",
          status: "verified",
          temporal: {
            type: "conditional",
            date: "2026-10-22",
            raw_text: "雨天の場合は10月22日まで",
            condition: "雨天",
          },
        }),
      ],
      { actions: [perAction("act_001", true)] },
    );
    const ics = exportIcs(m);
    expect(ics).not.toContain("BEGIN:VTODO");
    expect(ics).not.toContain("DUE");
  });
});

describe("K: ICS UID collision prevention across documents", () => {
  it("same action id in different documents yields different opaque UIDs", async () => {
    const text = "令和8年10月15日に秋の遠足を実施します。";
    const a = await consumePlainText(text, "doc-A");
    const b = await consumePlainText(text, "doc-B");

    expect(a.ready.length).toBe(1);
    expect(b.ready.length).toBe(1);
    // Action ids are manifest-local: both are act_001.
    expect(a.ready[0]?.id).toBe("act_001");
    expect(b.ready[0]?.id).toBe("act_001");

    const uidA = uids(a.ics)[0]!;
    const uidB = uids(b.ics)[0]!;
    expect(uidA).not.toBe(uidB);
    expect(uidA).toMatch(/^[a-f0-9]{64}@actionmanifest$/);
    // opaque: raw source ids never leak into calendar output
    expect(a.ics).not.toContain("doc-A");
    expect(b.ics).not.toContain("doc-B");
    // deterministic: re-exporting the same manifest yields the same UID
    expect(uids(exportIcs(a.manifest))[0]).toBe(uidA);
  });
});

describe("shared trust model — CLI-equivalent path stays consistent", () => {
  it("reference consumer exports exactly the ready actions, nothing more", async () => {
    const result = await consumePlainText(
      "令和8年10月15日に秋の遠足を実施します。\n健康診断は10月頃の予定です。",
      "mixed-trust",
    );
    // approximate-only action is not extracted as dated; whatever is ready
    // must equal what the exporter emits.
    const ics = result.ics;
    const exportedCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    const readyEvents = result.ready.filter((a) => a.kind === "event" && a.temporal?.date).length;
    expect(exportedCount).toBe(readyEvents);
    expect(() => exportIcs(result.manifest)).not.toThrowError(ExportError);
  });
});
