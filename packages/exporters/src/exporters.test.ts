import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type ActionManifest } from "@actionmanifest/core";
import { exportIcs, exportJson, formatSummary } from "./index.js";

const manifest: ActionManifest = {
  schema_version: SCHEMA_VERSION,
  source: { id: "s", hash: "abc" },
  actions: [
    {
      id: "act_001",
      kind: "event",
      title: "秋の遠足",
      modality: "required",
      actor: { certainty: "unknown" },
      temporal: { type: "exact", date: "2026-10-15", raw_text: "令和8年10月15日" },
      evidence: [{ source_id: "s", text: "令和8年10月15日に秋の遠足を実施します。" }],
      inference: "explicit",
      status: "proposed",
    },
    {
      id: "act_002",
      kind: "submit",
      title: "参加確認票を提出する",
      modality: "required",
      actor: { certainty: "explicit" },
      temporal: { type: "exact", date: "2026-10-05", raw_text: "10月5日まで" },
      evidence: [{ source_id: "s", text: "10月5日までに提出してください。" }],
      inference: "explicit",
      status: "proposed",
      conditions: ["参加を希望する"],
    },
    {
      id: "act_003",
      kind: "event",
      title: "頃の予定",
      modality: "unknown",
      actor: { certainty: "unknown" },
      temporal: { type: "approximate", month: 10, raw_text: "10月頃" },
      evidence: [{ source_id: "s", text: "10月頃" }],
      inference: "explicit",
      status: "proposed",
    },
  ],
};

describe("exporters", () => {
  it("exports JSON", () => {
    const json = exportJson(manifest);
    expect(JSON.parse(json).actions).toHaveLength(3);
  });

  it("exports VEVENT and VTODO but omits approximate undated actions", () => {
    const ics = exportIcs(manifest);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261015");
    expect(ics).toContain("BEGIN:VTODO");
    expect(ics).toContain("DUE;VALUE=DATE:20261005");
    expect(ics).not.toContain("頃の予定");
  });

  it("human summary quotes evidence", () => {
    const s = formatSummary(manifest);
    expect(s).toContain("秋の遠足");
    expect(s).toContain("参加確認票");
    expect(s).toContain("Evidence");
  });
});
