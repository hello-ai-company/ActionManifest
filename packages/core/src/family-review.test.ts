import { describe, it, expect } from "vitest";
import { createDocumentEvidenceIndex, verifyDocumentCitation } from "./document-query.js";
import { FAMILY_DOMAINS, FAMILY_TOPICS, type FamilyDomain, type FamilyTopic } from "./family-review.js";

const source = { id: "family-local", text: "学校からのお知らせ\n宿題の提出期限は１０月２０日。\n希望者のみ提出。前回の期限は訂正します。\n持ち物は不要です。\n図書館の返却は明日。\n受診予約は病院に電話。\nわからない文章も表示する。" };
describe("local family evidence review", () => {
  it("keeps every source passage reachable, with honest coverage and no inferred member", () => {
    const index = createDocumentEvidenceIndex(source);
    const result = index.familyReview({ limit: 2 });
    expect(result.coverage).toMatchObject({ indexedPassages: 7, matchingPassages: 7, returnedPassages: 2, offset: 0, hasMore: true, nextOffset: 2, completeUnderstanding: false });
    expect(result.member).toEqual({ status: "unassigned", sourceIdentityVerified: false });
    const all = [result, index.familyReview({ offset: 2, limit: 2 }), index.familyReview({ offset: 4, limit: 2 }), index.familyReview({ offset: 6, limit: 2 })].flatMap(r => r.items);
    expect(all).toHaveLength(7);
    expect(all.at(-1)?.domains).toEqual(["other"]);
    expect(all.at(-1)?.citation.quote).toBe("わからない文章も表示する。");
    for (const item of all) for (const c of item.context) expect(verifyDocumentCitation(source, c)).toBe(true);
  });
  it("finds domain and topic cues without applying adjacent person's or document heading identity", () => {
    const review = createDocumentEvidenceIndex(source).familyReview();
    expect(review.items[1]?.domains).toEqual(["homework"]);
    expect(review.items[1]?.topics).toContain("deadline");
    expect(review.items[1]?.topics).toContain("submission");
    expect(review.items[1]?.flags).toEqual(expect.arrayContaining(["conditional", "revision"]));
    expect(review.items[3]?.flags).toContain("negated");
    expect(review.items[4]?.flags).toContain("relative_date");
    expect(review.items[4]?.citation.quote).toBe("図書館の返却は明日。");
  });
  it.each([
    ["school", "小学校の開催日程"], ["lessons", "ピアノ教室のレッスン"], ["childcare", "保育所のお迎え"],
    ["health", "病院の予約"], ["travel", "旅行のホテル予約"], ["homework", "宿題の提出"],
    ["library", "図書館の返却"], ["safety", "警察の問い合わせ"], ["household", "家事の準備"], ["other", "短文です"],
  ] as [FamilyDomain, string][])("covers %s as cue or explicit other fallback", (domain, text) => {
    expect(createDocumentEvidenceIndex({ id: domain, text }).familyReview().items[0]?.domains).toContain(domain);
  });
  it.each([
    ["schedule", "集合日時"], ["deadline", "期限"], ["requirements", "持ち物"], ["submission", "提出"],
    ["reservation", "予約"], ["contact", "問い合わせ"], ["cost", "１５０円"], ["other", "短文"],
  ] as [FamilyTopic, string][])("covers %s topic", (topic, text) => {
    expect(createDocumentEvidenceIndex({ id: topic, text }).familyReview().items[0]?.topics).toContain(topic);
  });
  it("filters by cues with stable pagination rather than silently truncating long input", () => {
    const text = Array.from({ length: 130 }, (_, i) => i % 2 ? `図書館の返却 ${i}` : `学校の提出 ${i}`).join("\n");
    const index = createDocumentEvidenceIndex({ id: "long", text });
    const first = index.familyReview({ domain: "school", topic: "submission", limit: 50 });
    const last = index.familyReview({ domain: "school", topic: "submission", limit: 50, offset: first.coverage.nextOffset });
    expect(first.coverage).toMatchObject({ indexedPassages: 130, matchingPassages: 65, hasMore: true });
    expect(last.items).toHaveLength(15); expect(last.coverage.hasMore).toBe(false);
    expect(new Set([...first.items, ...last.items].map(i => i.citation.start)).size).toBe(65);
  });
  it("does not merge documents, revisions, people or conflicting numbers", () => {
    const a = createDocumentEvidenceIndex({ id: "a", text: "太郎 学校 提出期限１０月１日\n花子 学校 提出期限１０月２日" });
    const b = createDocumentEvidenceIndex({ id: "b", text: "改訂 学校 提出期限１０月３日" });
    const result = a.familyReview({ memberLabel: "花子" });
    expect(result.items).toHaveLength(2);
    expect(result.member).toEqual({ status: "user_selected", label: "花子", sourceIdentityVerified: false });
    expect(() => b.annotateFamilyCitation({ kind: "user_annotation", citation: result.items[0]!.citation, memberLabel: "花子" })).toThrow();
  });
  it("keeps user corrections separate, rejects stale or altered citations, and copies data", () => {
    const index = createDocumentEvidenceIndex(source), original = index.familyReview().items[0]!.citation;
    const annotation = index.annotateFamilyCitation({ kind: "user_annotation", citation: original, domain: "other", note: "学校ではなく習い事", memberLabel: "A" });
    expect(annotation.kind).toBe("user_annotation"); expect(annotation.citation.quote).toBe(original.quote);
    annotation.citation.quote = "edited";
    expect(index.familyReview().items[0]!.citation.quote).toBe(original.quote);
    expect(() => index.annotateFamilyCitation(annotation)).toThrow();
    const revised = createDocumentEvidenceIndex({ ...source, text: source.text + "\n訂正" });
    expect(() => revised.annotateFamilyCitation({ kind: "user_annotation", citation: original })).toThrow();
    expect(() => index.annotateFamilyCitation({ kind: "user_annotation", citation: original, note: "x".repeat(513) })).toThrow();
  });
  it("never crosses page context or invents locators", () => {
    const doc = { id: "pages", pages: [{ pageNumber: 1, text: "学校の提出" }, { pageNumber: 2, text: "中止の場合" }] };
    const review = createDocumentEvidenceIndex(doc).familyReview();
    expect(review.items[0]?.flags).toEqual([]);
    expect(review.items[0]?.context).toHaveLength(1);
    expect(review.items[1]?.flags).toContain("negated");
    expect(review.items[0]?.citation.page).toBe(1);
    expect(createDocumentEvidenceIndex(source).familyReview().items[0]?.citation.page).toBeUndefined();
  });
  it("preserves short, long-line and supplementary Unicode source spans", () => {
    const text = "𠮷".repeat(501) + "図書館の返却は明日。";
    const doc = { id: "unicode", text };
    const result = createDocumentEvidenceIndex(doc).familyReview();
    expect(result.items).toHaveLength(2);
    expect(result.items.map(i => i.citation.quote).join("")).toBe(text);
    result.items.forEach(i => expect(verifyDocumentCitation(doc, i.citation)).toBe(true));
    expect(() => createDocumentEvidenceIndex({ id: "empty", text: "" })).toThrow();
  });
  it("does not classify English suffixes as whole-word cues", () => {
    for (const text of ["piano lesson", "notification", "motif", "carpet", "upstart", "schoolhouse"]) {
      const item = createDocumentEvidenceIndex({ id: "boundary", text }).familyReview().items[0]!;
      expect(item.flags).toEqual([]);
      expect(item.topics).toEqual(["other"]);
      expect(item.domains).toEqual(text === "piano lesson" ? ["lessons"] : ["other"]);
    }
  });
  it("isolates cached family hints from mutable returned arrays", () => {
    const index = createDocumentEvidenceIndex(source);
    const result = index.familyReview();
    result.items[0]!.domains.push("health"); result.items[1]!.flags.length = 0;
    expect(index.familyReview().items[0]!.domains).toEqual(["school"]);
    expect(index.familyReview().items[1]!.flags).toContain("conditional");
  });
  it("honors cancellation, limits and invalid filter/annotation input", () => {
    const index = createDocumentEvidenceIndex(source);
    const controller = new AbortController(); controller.abort();
    expect(() => index.familyReview({ signal: controller.signal })).toThrow();
    for (const limit of [0, 51, 1.5, NaN, Infinity]) expect(() => index.familyReview({ limit })).toThrow();
    for (const offset of [-1, 20001, 1.5, NaN]) expect(() => index.familyReview({ offset })).toThrow();
    expect(() => index.familyReview({ domain: "fake" as FamilyDomain })).toThrow();
    expect(() => index.familyReview({ topic: "fake" as FamilyTopic })).toThrow();
    expect(() => index.familyReview({ memberLabel: "x".repeat(129) })).toThrow();
    expect(index.familyReview({ offset: 20000 }).coverage.hasMore).toBe(false);
    expect(FAMILY_DOMAINS).toHaveLength(10); expect(FAMILY_TOPICS).toHaveLength(8);
  });
});
