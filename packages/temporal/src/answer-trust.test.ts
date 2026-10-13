import { describe, expect, it } from "vitest";
import { conditionalClauses, detectModality } from "./modality.js";
import { primaryTemporal } from "./parse.js";

describe("explicit English rescheduling", () => {
  it.each([
    ["The field trip was scheduled for October 15, 2026, but has been rescheduled to October 22, 2026.", "2026-10-22"],
    ["The field trip on October 22, 2026 has been rescheduled to October 15, 2026.", "2026-10-15"],
  ])("removes only the explicitly superseded date: %s", (text, date) => {
    expect(primaryTemporal(text)?.date).toBe(date);
  });
  it.each([
    "The field trip was scheduled for October 15, 2026, but has been rescheduled to a later date.",
    "The field trip on October 22, 2026 has been rescheduled to a later date.",
    "The field trip was scheduled for October 15, 2026, but has been rescheduled to October 22, 2026 or October 29, 2026.",
    "The field trip on October 22, 2026 has been rescheduled to October 15, 2026 or October 29, 2026.",
    "The field trip was scheduled for October 15, 2026, but has not been rescheduled to October 22, 2026.",
    "The field trip was scheduled for October 15, 2026, but may be rescheduled to October 22, 2026.",
    "The field trip was scheduled for October 15, 2026, but could be rescheduled to October 22, 2026.",
    "The field trip was scheduled for October 15, 2026, but will be rescheduled to October 22, 2026 if approved.",
    "The field trip was scheduled for October 15, 2026, but has been rescheduled to October 22, 2026 or early November.",
    "The field trip was scheduled for October 15, 2026, but has been rescheduled to October 22, 2026 or a later date.",
    "The field trip was scheduled for October 15, 2026, but has been rescheduled to October 22, 2026 or October 29.",
    "The field trip was scheduled for October 15, 2026, but has been rescheduled to October 15, 2026 or October 22, 2026.",
    "The field trip on October 15, 2026 has been rescheduled to October 22, 2026 or October 15, 2026.",
    "The field trip was scheduled for October 15, 2026, but has been rescheduled; October 22, 2026 is unavailable.",
    "The field trip was scheduled for October 15, 2026, but the claim that it has been rescheduled to October 22, 2026 is false.",
    "The field trip was scheduled for October 15, 2026; the meeting has been rescheduled to October 22, 2026.",
  ])("does not invent a missing or ambiguous replacement: %s", text => {
    expect(primaryTemporal(text)).toBeUndefined();
  });
});

describe("Japanese notice corrections and conditional preparation", () => {
  it.each([
    "遠足の日程を令和8年10月15日または10月22日に変更します。",
    "遠足の日程を令和8年10月22日または10月15日に変更します。",
  ])("does not select an unresolved replacement by proximity: %s", text => {
    expect(primaryTemporal(text, { year: 2026 })).toBeUndefined();
  });
  it("does not resurrect the old date when the replacement is absent", () => {
    expect(primaryTemporal("遠足の日程を令和8年10月15日から変更します。", { year: 2026 })).toBeUndefined();
  });
  it.each([
    ["遠足を令和8年10月15日から10月22日に変更します。", "2026-10-22"],
    ["遠足を令和8年10月22日から10月15日に変更します。", "2026-10-15"],
    ["令和8年10月22日の予定を変更し、10月15日に実施します。", "2026-10-15"],
  ])("keeps the explicitly resolved replacement: %s", (text, date) => {
    expect(primaryTemporal(text, { year: 2026 })?.date).toBe(date);
  });
  it.each([
    ["雨天の場合は、タオルを持参してください。", "雨天の場合は"],
    ["雨天時は、タオルを持参してください。", "雨天時は"],
    ["雨天なら、タオルを持参してください。", "雨天なら"],
    ["屋外活動に参加する場合のみ、帽子を用意してください。", "屋外活動に参加する場合のみ"],
    ["雨が降ったときは、水筒を持参してください。", "雨が降ったときは"],
  ])("preserves the explicit condition: %s", (text, condition) => {
    expect(conditionalClauses(text)).toContain(condition);
    expect(detectModality(text).conditions).toContain(condition);
    expect(detectModality(text).modality).toBe("required");
  });
});
