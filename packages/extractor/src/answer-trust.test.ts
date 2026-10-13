import { describe, expect, it } from "vitest";
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { SCHEMA_VERSION } from "@actionmanifest/core";
import { verifyManifest } from "@actionmanifest/verifier";
import { extractDeterministically } from "./deterministic.js";

async function pipeline(text: string) {
  const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id: "synthetic-notice", text });
  return verifyManifest({ schema_version: SCHEMA_VERSION, source: { id: doc.id, hash: doc.sourceHash }, actions: extractDeterministically(doc) }, doc);
}

describe("corrected, cancelled and conditional Japanese notices", () => {
  it("removes the uniquely named superseded date without changing another event", async () => {
    const { manifest } = await pipeline("遠足は令和8年10月15日に実施します。遠足の日程を10月22日に変更します。説明会は10月20日に実施します。");
    expect(manifest.actions).toHaveLength(2);
    expect(manifest.actions.map(a => a.temporal?.date).sort()).toEqual(["2026-10-20", "2026-10-22"]);
    expect(manifest.actions.every(a => a.status === "verified")).toBe(true);
  });
  it("removes the date when a uniquely named correction remains unresolved", async () => {
    const { manifest } = await pipeline("遠足は令和8年10月15日に実施します。遠足の日程を10月22日または10月29日に変更します。");
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.actions[0]?.temporal?.date).toBeUndefined();
  });
  it.each([
    ["申込書", "追加申込書"],
    ["参加確認票", "不参加確認票"],
  ])("does not merge distinct forms %s and %s", async (original, additional) => {
    const { manifest } = await pipeline(`${original}を令和8年10月5日までに提出してください。${additional}の提出期限を10月12日に変更します。`);
    expect(manifest.actions).toHaveLength(2);
    expect(manifest.actions.map(a => [a.object, a.temporal?.date, a.status])).toEqual([
      [original, "2026-10-05", "verified"], [additional, "2026-10-12", "verified"],
    ]);
  });
  it.each([
    ["追加説明会", "説明会"],
    ["説明会", "追加説明会"],
  ])("does not merge distinct event names %s and %s", async (original, additional) => {
    const { manifest } = await pipeline(`${original}は令和8年10月5日に開催します。${additional}の日程を10月12日に変更します。`);
    expect(manifest.actions).toHaveLength(2);
    expect(manifest.actions.map(a => [a.temporal?.date, a.status])).toEqual([
      ["2026-10-05", "verified"], ["2026-10-12", "verified"],
    ]);
  });
  it("resolves a named submission deadline even without the 提出 verb in the correction", async () => {
    const { manifest } = await pipeline("参加確認票は希望者のみ、令和8年10月5日までに提出してください。参加確認票の締切を10月12日に変更します。");
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.actions[0]).toMatchObject({ kind: "submit", status: "verified", temporal: { date: "2026-10-12" } });
    expect(manifest.actions[0]?.conditions).toContain("希望者のみ");
  });
  it("keeps only the last explicit same-target date correction", async () => {
    const { manifest } = await pipeline("遠足は令和8年10月15日に実施します。遠足の日程を10月22日に変更します。遠足の日程を10月29日に変更します。");
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.actions[0]).toMatchObject({ status: "verified", temporal: { date: "2026-10-29" } });
  });
  it("does not choose among two prior same-named targets", async () => {
    const { manifest } = await pipeline("遠足は令和8年10月15日に実施します。遠足は10月20日に実施します。遠足の日程を10月22日に変更します。");
    expect(manifest.actions).toHaveLength(0);
  });
  it("keeps optional participation when only an event date is corrected", async () => {
    const { manifest } = await pipeline("説明会は任意です。説明会の日程を令和8年10月22日に変更します。");
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.actions[0]).toMatchObject({ modality: "optional", status: "verified", temporal: { date: "2026-10-22" } });
    expect(manifest.actions[0]?.evidence.some(e => e.text.includes("任意"))).toBe(true);
  });
  it("keeps eligibility and its evidence when only a submission date changes", async () => {
    const { manifest } = await pipeline("参加確認票は希望者のみ、令和8年10月5日までに提出してください。参加確認票の提出期限を10月12日に変更します。");
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.actions[0]).toMatchObject({ status: "verified", temporal: { date: "2026-10-12" } });
    expect(manifest.actions[0]?.conditions).toContain("希望者のみ");
    expect(manifest.actions[0]?.actor.role).toBe("applicant");
  });
  it("does not turn preparing a hat into bringing it", async () => {
    const { manifest } = await pipeline("屋外活動に参加する場合のみ、帽子を用意してください。");
    expect(manifest.actions[0]?.title).toBe("帽子を用意する");
  });
  it("recognizes a cancelled bare subject and preserves an unrelated event", async () => {
    const { manifest } = await pipeline("遠足は令和8年10月15日に実施します。遠足は中止となりました。説明会は10月20日に実施します。");
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.actions[0]).toMatchObject({ status: "verified", temporal: { date: "2026-10-20" } });
  });
  it("does not verify a withdrawn preparation, but still verifies the separate submission", async () => {
    const { manifest, flags } = await pipeline("水筒を持参してください。水筒は不要です。参加確認票を提出してください。");
    expect(manifest.actions.find(a => a.kind === "prepare")?.status).toBe("proposed");
    expect(manifest.actions.find(a => a.kind === "submit")?.status).toBe("verified");
    expect(flags.actions?.find(a => !a.passed)?.issues.some(i => i.code === "NEGATION_CONFLICT")).toBe(true);
  });
  it.each([
    ["雨天の場合は、タオルを持参してください。", "雨天の場合は"],
    ["屋外活動に参加する場合のみ、帽子を用意してください。", "屋外活動に参加する場合のみ"],
  ])("preserves conditional preparation: %s", async (text, condition) => {
    const { manifest } = await pipeline(text);
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.actions[0]).toMatchObject({ kind: "prepare", status: "verified", conditions: [condition] });
  });
});
