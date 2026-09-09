import { describe, expect, it } from "vitest";
import { detectKind, detectModality } from "./modality.js";
import { isNegation } from "./parse.js";

describe("Japanese modality", () => {
  it("希望者のみ is optional/conditional", () => {
    const m = detectModality("英語クラブは希望者のみです。");
    expect(m.conditions).toContain("希望者のみ");
  });

  it("参加者のみ is a condition", () => {
    const m = detectModality("参加者のみ会場地図を配布します。");
    expect(m.conditions).toContain("参加者のみ");
    expect(m.actor.role).toBe("participant");
  });

  it("各自持参 is required for participants", () => {
    const m = detectModality("昼食は各自持参してください。");
    expect(m.modality).toBe("required");
    expect(m.conditions).toContain("各自持参");
  });

  it("当日徴収 is required pay-on-day", () => {
    const m = detectModality("参加費は当日徴収します。");
    expect(m.modality).toBe("required");
    expect(m.conditions).toContain("当日徴収");
  });

  it("後日提出 is a later-submit condition", () => {
    const m = detectModality("報告書は後日提出してください。");
    expect(m.conditions).toContain("後日提出");
    expect(detectKind("報告書は後日提出してください。")).toBe("submit");
  });

  it("提出不要 is prohibited", () => {
    const m = detectModality("変更届は提出不要です。");
    expect(m.modality).toBe("prohibited");
    expect(m.negated).toBe(true);
  });

  it("前回提出した方は不要 is preserved", () => {
    const text = "前回提出した方は不要です。";
    const m = detectModality(text);
    expect(m.conditions.some((c) => c.includes("前回提出"))).toBe(true);
    expect(isNegation("再提出する必要はありません。")).toBe(true);
  });
});
