import { describe, expect, it } from "vitest";
import { ExportError, SCHEMA_VERSION, type Action, type ActionManifest } from "@actionmanifest/core";
import { exportIcs, exportJson, formatSummary } from "./index.js";

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

const manifest: ActionManifest = {
  schema_version: SCHEMA_VERSION,
  source: { id: "s", hash: "abc" },
  actions: [
    makeAction({
      id: "act_001",
      kind: "event",
      title: "秋の遠足",
      temporal: { type: "exact", date: "2026-10-15", raw_text: "令和8年10月15日" },
      evidence: [{ source_id: "s", text: "令和8年10月15日に秋の遠足を実施します。" }],
      status: "verified",
    }),
    makeAction({
      id: "act_002",
      kind: "submit",
      title: "参加確認票を提出する",
      temporal: { type: "exact", date: "2026-10-05", raw_text: "10月5日まで" },
      evidence: [{ source_id: "s", text: "10月5日までに提出してください。" }],
      conditions: ["参加を希望する"],
      status: "verified",
    }),
    makeAction({
      id: "act_003",
      kind: "event",
      title: "頃の予定",
      modality: "unknown",
      temporal: { type: "approximate", month: 10, raw_text: "10月頃" },
      evidence: [{ source_id: "s", text: "10月頃" }],
      status: "verified",
    }),
    makeAction({
      id: "act_004",
      kind: "submit",
      title: "検証に落ちた提出物",
      temporal: { type: "exact", date: "2026-11-01", raw_text: "11月1日" },
      status: "proposed",
    }),
  ],
};

describe("exportJson", () => {
  it("defaults to verified-only and keeps the receipt", () => {
    const withReceipt: ActionManifest = {
      ...manifest,
      receipt: {
        extraction: {
          provider: "t",
          model: "t",
          extractor_version: "0",
          schema_version: SCHEMA_VERSION,
          created_at: "t",
        },
      },
    };
    const parsed = JSON.parse(exportJson(withReceipt)) as ActionManifest;
    expect(parsed.actions.map((a) => a.id)).toEqual(["act_001", "act_002", "act_003"]);
    expect(parsed.receipt).toBeDefined();
  });

  it("include: \"all\" keeps every action (explicit opt-in)", () => {
    const parsed = JSON.parse(exportJson(manifest, { include: "all" })) as ActionManifest;
    expect(parsed.actions).toHaveLength(4);
  });

  it("accepts the legacy boolean pretty signature", () => {
    expect(exportJson(manifest, true)).toContain("\n");
    expect(exportJson(manifest, false)).not.toContain("\n ");
  });
});

describe("exportIcs", () => {
  it("exports verified VEVENT/VTODO; approximate and unverified are omitted by default", () => {
    const ics = exportIcs(manifest);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261015");
    expect(ics).toContain("BEGIN:VTODO");
    expect(ics).toContain("DUE;VALUE=DATE:20261005");
    // approximate without a calendar day: never materialized
    expect(ics).not.toContain("頃の予定");
    // unverified action: excluded by the default verified-only policy
    expect(ics).not.toContain("検証に落ちた提出物");
    expect(ics).not.toContain("20261101");
  });

  it("include: \"all\" emits unverified actions with an explicit marker", () => {
    const ics = exportIcs(manifest, { include: "all" });
    expect(ics).toContain("検証に落ちた提出物");
    expect(ics).toContain("X-ACTIONMANIFEST-STATUS:proposed");
  });

  it("refuses to export when the receipt shows a manifest-level fatal", () => {
    const fatal: ActionManifest = {
      ...manifest,
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
          source_hash_matched: false,
          negation_conflict: false,
          page_refs_valid: true,
          passed: false,
          issues: [{ code: "SOURCE_HASH_MISMATCH", message: "hash mismatch" }],
        },
      },
    };
    expect(() => exportIcs(fatal)).toThrowError(ExportError);
    expect(() => exportIcs(fatal, { include: "all" })).toThrowError(ExportError);
    expect(() => exportJson(fatal)).toThrowError(ExportError);
  });

  it("conditional rain alternative never overwrites the primary DTSTART", () => {
    const withRain: ActionManifest = {
      ...manifest,
      actions: [
        makeAction({
          id: "act_010",
          kind: "event",
          title: "秋の遠足",
          status: "verified",
          temporal: {
            type: "exact",
            date: "2026-10-15",
            raw_text: "10月15日",
            alternatives: [
              { type: "conditional", date: "2026-10-22", raw_text: "雨天の場合は10月22日", condition: "雨天" },
            ],
          },
        }),
      ],
    };
    const ics = exportIcs(withRain);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261015");
    expect(ics).not.toContain("DTSTART;VALUE=DATE:20261022");
    expect(ics).toContain("COMMENT:alternative 2026-10-22");
  });
});

describe("summary", () => {
  it("human summary quotes evidence", () => {
    const s = formatSummary(manifest);
    expect(s).toContain("秋の遠足");
    expect(s).toContain("参加確認票");
    expect(s).toContain("Evidence");
  });
});
