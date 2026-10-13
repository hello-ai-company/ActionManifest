import { describe, expect, it } from "vitest";
import { answerDocumentQuestion } from "./document-query.js";
import { createDocumentEvidenceIndex } from "@actionmanifest/core";

describe("offline document question facade", () => {
  it("includes exact neighboring context for qualifications and conditions", () => {
    const answer = answerDocumentQuestion({ id: "notice", text: "遠足について\n参加費は1000円。\nただし雨天中止時のみ返金します。" }, { kind: "cost" });
    expect(answer.context.map(c => c.quote)).toEqual(["遠足について", "参加費は1000円。", "ただし雨天中止時のみ返金します。"]);
    expect(answer.evidence).toHaveLength(1);
  });
  it("never expands across a page boundary", () => {
    const answer = answerDocumentQuestion({ id: "pages", pages: [{ pageNumber: 1, text: "Fee: $20" }, { pageNumber: 2, text: "Other subject" }] }, { kind: "cost" });
    expect(answer.context).toHaveLength(1);
  });
  it("rejects stale context expansion and bounds radius", () => {
    const index = createDocumentEvidenceIndex({ id: "one", text: "Cost: $2" });
    const citation = index.query({ kind: "cost" }).evidence[0]!;
    expect(() => index.explainCitation({ ...citation, quote: "Cost: $99" })).toThrow();
    expect(() => index.explainCitation(citation, 4)).toThrow();
    expect(() => index.explainCitation(citation, -1)).toThrow();
  });
});
