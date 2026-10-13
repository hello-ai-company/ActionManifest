import { describe, expect, it } from "vitest";
import type { Action } from "@actionmanifest/core";
import { cancellationConflict, conditionsSupported, negationConflict, temporalEvidenceSupported } from "./semantics.js";

const candidate = (text: string, overrides: Partial<Action> = {}): Action => ({
  id: "action", kind: "prepare", title: "準備する", modality: "required",
  actor: { certainty: "unknown" }, inference: "explicit", status: "proposed",
  evidence: [{ source_id: "synthetic", text }], ...overrides,
});
const exact = (date: string) => ({ type: "exact" as const, date, raw_text: date });

describe("action-local semantic trust", () => {
  it("rejects a date supported only by another action in the document", () => {
    const a = candidate("参加票を提出してください。", { temporal: exact("2026-10-20") });
    expect(temporalEvidenceSupported(a, { year: 2026 })).toBe(false);
  });
  it.each(["unknown", "relative", "range"] as const)("does not let temporal type %s bypass date evidence", type => {
    const a = candidate("参加票を提出してください。", { temporal: { type, date: "2026-10-20", raw_text: "10月20日" } });
    expect(temporalEvidenceSupported(a, { year: 2026 })).toBe(false);
  });
  it("rejects an approximate date even when that exact day occurs elsewhere", () => {
    const a = candidate("健康診断は10月頃です。", { kind: "event", temporal: exact("2026-10-01") });
    expect(temporalEvidenceSupported(a, { year: 2026 })).toBe(false);
  });
  it("still inherits the document year for an evidence-local month/day", () => {
    const a = candidate("10月20日までに参加票を提出してください。", { temporal: exact("2026-10-20") });
    expect(temporalEvidenceSupported(a, { year: 2026 })).toBe(true);
  });
  it("rejects the real but superseded date, accepts the replacement", () => {
    const text = "遠足を令和8年10月15日から10月22日に変更します。";
    expect(temporalEvidenceSupported(candidate(text, { temporal: exact("2026-10-15") }), { year: 2026 })).toBe(false);
    expect(temporalEvidenceSupported(candidate(text, { temporal: exact("2026-10-22") }), { year: 2026 })).toBe(true);
  });
  it.each(["2026-10-15", "2026-10-22"])("rejects an unresolved correction date %s", date => {
    const a = candidate("遠足の日程を令和8年10月15日または10月22日に変更します。", { temporal: exact(date) });
    expect(temporalEvidenceSupported(a, { year: 2026 })).toBe(false);
  });
  it("can retain original eligibility evidence alongside an explicit date correction", () => {
    const a = candidate("参加確認票の提出期限を10月12日に変更します。", { kind: "submit", temporal: exact("2026-10-12") });
    a.evidence.push({ source_id: "synthetic", text: "参加確認票は希望者のみ、令和8年10月5日までに提出してください。" });
    expect(temporalEvidenceSupported(a, { year: 2026 })).toBe(true);
    expect(temporalEvidenceSupported({ ...a, temporal: exact("2026-10-05") }, { year: 2026 })).toBe(false);
  });
  it("checks nested alternative dates against the action evidence", () => {
    const a = candidate("10月15日に実施します。", { temporal: { ...exact("2026-10-15"), alternatives: [{ ...exact("2026-10-20"), type: "conditional", condition: "雨天" }] } });
    expect(temporalEvidenceSupported(a, { year: 2026 })).toBe(false);
  });
  it("preserves explicitly supported rain alternatives", () => {
    const a = candidate("10月15日に実施します。雨天の場合は10月20日に延期します。", { kind: "event", temporal: { ...exact("2026-10-15"), alternatives: [{ ...exact("2026-10-20"), type: "conditional", condition: "雨天" }] } });
    expect(temporalEvidenceSupported(a, { year: 2026 })).toBe(true);
    expect(conditionsSupported(a)).toBe(true);
  });
  it.each(["prepare", "pay", "sign", "reply", "submit"] as const)("rejects a blanket negated required %s", kind => {
    expect(negationConflict(candidate("その手続きは不要です。", { kind }))).toBe(true);
  });
  it("does not treat an invented exemption condition as source evidence", () => {
    expect(negationConflict(candidate("参加票の提出は不要です。", { kind: "submit", conditions: ["前回提出した方は不要"] }))).toBe(true);
  });
  it("does not let an exemption hide a separate blanket withdrawal", () => {
    const a = candidate("前回提出した方は再提出不要です。参加票の提出は不要です。", { kind: "submit", conditions: ["前回提出した方は再提出不要"] });
    expect(negationConflict(a)).toBe(true);
  });
  it("does not accept a condition with the opposite meaning", () => {
    const a = candidate("雨天の場合は、タオルを持参してください。", { conditions: ["雨天ではない場合は"] });
    expect(conditionsSupported(a)).toBe(false);
  });
  it("preserves a source-supported prior-submission exemption", () => {
    const a = candidate("参加票を提出してください。前回提出した方は再提出不要です。", { kind: "submit", conditions: ["前回提出した方は再提出不要"] });
    expect(negationConflict(a)).toBe(false);
  });
  it("does not create a conflict for prohibited actions", () => {
    expect(negationConflict(candidate("水筒は不要です。", { modality: "prohibited" }))).toBe(false);
  });
  it("requires the actual weather condition, not any arbitrary condition", () => {
    const a = candidate("雨天の場合は、タオルを持参してください。");
    expect(conditionsSupported(a)).toBe(false);
    expect(conditionsSupported({ ...a, conditions: ["参加者のみ"] })).toBe(false);
    expect(conditionsSupported({ ...a, conditions: ["雨天"] })).toBe(true);
    expect(conditionsSupported({ ...a, conditions: ["雨天の場合は"] })).toBe(true);
  });
  it.each(["雨天時は", "雨天なら"])("does not lose the short weather predicate %s", condition => {
    const a = candidate(`${condition}、タオルを持参してください。`);
    expect(conditionsSupported(a)).toBe(false);
    expect(conditionsSupported({ ...a, conditions: [condition] })).toBe(true);
  });
  it("preserves a participation condition verbatim", () => {
    const a = candidate("屋外活動に参加する場合のみ、帽子を用意してください。");
    expect(conditionsSupported(a)).toBe(false);
    expect(conditionsSupported({ ...a, conditions: ["屋外活動に参加する場合のみ"] })).toBe(true);
  });
  it("rejects an active event backed by its cancellation quote", () => {
    expect(cancellationConflict(candidate("遠足は中止となりました。", { kind: "event" }))).toBe(true);
    expect(cancellationConflict(candidate("説明会を開催します。", { kind: "event" }))).toBe(false);
  });
});
