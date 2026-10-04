import { describe, expect, it } from "vitest";
import { createSourceQuoteMatcher, sourceContainsQuote } from "./hash.js";

describe("request-local quote matching", () => {
  it.each([
    ["参加票を提出してください", true],
    ["「参加票」を 提出してください。", true],
    ["参加票を提出してください！", true],
    ["短文。", false], // the punctuation-only fallback still requires 8 characters
    ["存在しない提出先", false],
    ["『』 \n", false],
    ["", false],
  ] as const)("preserves the existing quote rule for %s", (quote, accepted) => {
    const source = "参加票を提出してください\n短文";
    expect(createSourceQuoteMatcher(source)(quote)).toBe(accepted);
    expect(sourceContainsQuote(source, quote)).toBe(accepted);
  });

  it("never shares source state across same-ID requests or Unicode variants", () => {
    const first = createSourceQuoteMatcher("Ａ学校に提出してください");
    const second = createSourceQuoteMatcher("B学校に提出してください");
    expect(first("Ａ学校に提出してください")).toBe(true);
    expect(second("Ａ学校に提出してください")).toBe(false);
    expect(first("A学校に提出してください")).toBe(false); // no new Unicode normalization
  });
});
