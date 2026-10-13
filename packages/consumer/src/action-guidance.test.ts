import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ActionManifest } from "@actionmanifest/core";
import { classifyManifest, explainManifest, formatActionGuidance } from "./index.js";
const fixture = () => JSON.parse(readFileSync(new URL("../fixtures/matoe-v02/golden.json", import.meta.url), "utf8")) as ActionManifest;

describe("display-only action guidance", () => {
  it("keeps the existing trust result, immutable input, stable ordering and no authority", () => {
    const input = fixture(); const before = JSON.stringify(input);
    const report = explainManifest(input);
    expect(report).toEqual(explainManifest(input));
    expect(report.counts).toEqual(classifyManifest(input).counts);
    expect(report.actions.map(row => row.action_id)).toEqual(input.actions.map(action => action.id));
    expect(report.authority).toEqual({ display_only: true, execution_allowed: false, human_approval_required: true });
    expect(report.verification_basis).toBe("supplied_receipt_only");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("hides exact evidence by default and clones opt-in evidence", () => {
    const input = fixture(); input.actions[0]!.evidence[0]!.text = "SYNTHETIC_PRIVATE_QUOTE";
    expect(JSON.stringify(explainManifest(input))).not.toContain("SYNTHETIC_PRIVATE_QUOTE");
    const explicit = explainManifest(input, { includeEvidence: true });
    expect(explicit.actions[0]!.evidence).toEqual(input.actions[0]!.evidence);
    explicit.actions[0]!.evidence![0]!.text = "changed";
    expect(input.actions[0]!.evidence[0]!.text).toBe("SYNTHETIC_PRIVATE_QUOTE");
  });
  it("leaves missing verification visible instead of inventing readiness", () => {
    const input = fixture(); delete input.receipt;
    const report = explainManifest(input);
    expect(report.actions.every(row => row.verification === "review_required")).toBe(true);
    expect(report.actions[0]!.verification_notes.join()).toContain("検証結果がありません");
  });
  it("keeps a fatal receipt blocking the entire report", () => {
    const input = fixture(); input.receipt!.verification!.source_hash_matched = false;
    const report = explainManifest(input);
    expect(report.manifest_fatal).toBe(true);
    expect(report.actions.every(row => row.verification === "blocked")).toBe(true);
    expect(report.actions[0]!.next_step).toContain("利用せず");
  });
  it("retains mixed pass/failure candidates and readable reasons without source messages", () => {
    const input = fixture(); const proof = input.receipt!.verification!.actions![0]!;
    proof.passed = false; proof.temporal_supported = false;
    proof.issues = [{ code: "TEMPORAL_UNSUPPORTED", message: "SYNTHETIC_PRIVATE_DIAGNOSTIC" }];
    const report = explainManifest(input);
    expect(report.actions).toHaveLength(input.actions.length);
    expect(report.actions[0]!.verification).toBe("blocked");
    expect(report.actions[0]!.verification_notes.join()).toContain("日時を原本");
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_PRIVATE_DIAGNOSTIC");
  });
  it.each(["accepted", "exported", "rejected"] as const)("does not convert %s to execution approval", status => {
    const input = fixture(); input.actions[0]!.status = status;
    const row = explainManifest(input).actions[0]!;
    if (status === "rejected") expect(row.verification).toBe("blocked");
    else expect(row.review_points.join()).toContain("実行許可");
  });
  it("asks about conditions, alternatives, uncertainty, timezone, actor and deadlines without choosing", () => {
    const input = fixture(); const action = input.actions[0]!;
    action.actor.certainty = "unknown"; action.inference = "inferred"; action.conditions = ["SYNTHETIC_CONDITION"];
    action.temporal = { type: "conditional", raw_text: "synthetic", condition: "synthetic", timezone: "Asia/Tokyo", certainty: "low", deadline_qualifier: "must_arrive", alternatives: [{ type: "relative", raw_text: "tomorrow" }] };
    const points = explainManifest(input).actions[0]!.review_points.join();
    for (const value of ["条件は未評価", "一意", "候補が複数", "タイムゾーン", "必着", "確かさ", "担当者", "推測"]) expect(points).toContain(value);
    expect(points).not.toContain("SYNTHETIC_CONDITION");
  });
  it.each(["pay", "submit", "reply", "contact", "sign"] as const)("never treats %s as a completed external action", kind => {
    const input = fixture(); input.actions[0]!.kind = kind;
    const points = explainManifest(input).actions[0]!.review_points.join();
    expect(points).toContain("本人"); expect(points).toContain("行いません");
  });
  it.each(["prohibited", "unknown", "x-unrecognized"] as const)("does not recommend execution for modality %s", modality => {
    const input = fixture(); input.actions[0]!.modality = modality;
    expect(explainManifest(input).actions[0]!.next_step).toContain("実行へ進めません");
  });
  it("keeps unknown action kinds explicit", () => {
    const input = fixture(); input.actions[0]!.kind = "x-unknown";
    const row = explainManifest(input).actions[0]!;
    expect(row.review_points.join()).toContain("定義されていません");
    expect(row.next_step).toContain("実行へ進めません");
  });
  it("handles an empty manifest without claiming no work exists", () => {
    const input = fixture(); input.actions = []; delete input.receipt;
    expect(formatActionGuidance(explainManifest(input))).toContain("用事がないという保証ではありません");
  });
  it("neutralizes terminal controls and bidi/newline spoofing but preserves exact JSON data", () => {
    const input = fixture(); input.actions[0]!.title = "Title\u001b[2J\nFAKE\u202E";
    input.actions[0]!.evidence[0]!.text = "quote\u0007\n\u2066fake";
    const report = explainManifest(input, { includeEvidence: true });
    const text = formatActionGuidance(report);
    for (const point of [0x1b, 0x07, 0x202e, 0x2066]) expect(text).not.toContain(String.fromCodePoint(point));
    expect(text).toContain("Title [2J FAKE ");
    expect(report.actions[0]!.title).toBe(input.actions[0]!.title);
  });
  it("performs no fetch and cannot mutate permissions or execution state", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("MUST_NOT_CALL"));
    try { explainManifest(fixture()); expect(fetch).not.toHaveBeenCalled(); } finally { fetch.mockRestore(); }
  });
});
