import { describe, expect, it } from "vitest";
import {
  extractYearContext,
  parseTemporals,
  primaryTemporal,
  reiwaToGregorian,
} from "./parse.js";

describe("Japanese temporal", () => {
  it("maps 令和8年 to 2026", () => {
    expect(reiwaToGregorian(8)).toBe(2026);
    expect(extractYearContext("令和8年10月5日").year).toBe(2026);
  });

  it("parses 令和8年10月5日 as an exact date", () => {
    const t = primaryTemporal("令和8年10月5日に実施します。");
    expect(t?.type).toBe("exact");
    expect(t?.date).toBe("2026-10-05");
    expect(t?.raw_text).toContain("令和8年10月5日");
  });

  it("parses 10月5日まで using document year context", () => {
    const ctx = extractYearContext("令和8年度のお知らせ。10月5日までに提出。");
    const t = primaryTemporal("10月5日までに提出してください。", ctx);
    expect(t?.date).toBe("2026-10-05");
    expect(t?.deadline_qualifier).toBe("until");
  });

  it("keeps 10月上旬 approximate without inventing a day", () => {
    const t = primaryTemporal("10月上旬にお知らせします。", { year: 2026 });
    expect(t?.type).toBe("approximate");
    expect(t?.date).toBeUndefined();
    expect(t?.decade).toBe("early");
    expect(t?.precision).toBe("decade_of_month");
  });

  it("keeps 10月頃 approximate — never 2026-10-01", () => {
    const t = primaryTemporal("健康診断は10月頃の予定です。", { year: 2026 });
    expect(t?.type).toBe("approximate");
    expect(t?.date).toBeUndefined();
    expect(t?.month).toBe(10);
    expect(JSON.stringify(t)).not.toContain("2026-10-01");
  });

  it("captures 雨天順延 as conditional", () => {
    const all = parseTemporals("運動会は雨天順延です。");
    expect(all.some((t) => t.type === "conditional" && t.condition === "雨天")).toBe(true);
  });

  it("captures 予備日", () => {
    const all = parseTemporals("予備日は翌月曜日です。");
    expect(all.some((t) => t.condition === "予備日")).toBe(true);
  });

  it("captures 必着 and 消印有効 qualifiers", () => {
    const arrive = parseTemporals("令和8年10月10日必着");
    expect(arrive.some((t) => t.deadline_qualifier === "must_arrive")).toBe(true);
    const post = parseTemporals("10月20日消印有効", { year: 2026 });
    expect(post.some((t) => t.deadline_qualifier === "postmark_valid")).toBe(true);
  });
});
