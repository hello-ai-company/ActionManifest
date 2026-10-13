import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDocumentEvidenceIndex, verifyDocumentCitation, FAMILY_DOMAINS } from "@actionmanifest/core";
const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/index.js");
const directory = mkdtempSync(resolve(tmpdir(), "family-review-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const run = (args: string[]) => spawnSync(process.execPath, [cli, "review-family", ...args], {
  encoding: "utf8", env: { ...process.env, ACTIONMAN_PROVIDER: "openai", OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1/must-not-call" },
});
const source = "学校の提出期限は明日。\n希望者のみ。\n持ち物は不要。\n分類されないひとこと。";
const file = resolve(directory, "notice.txt"); writeFileSync(file, source);
describe("built local family review API and CLI", () => {
  it("exports source-bound review and separate annotation without granting execution", () => {
    const doc = { id: "built-family", text: source }, index = createDocumentEvidenceIndex(doc);
    const review = index.familyReview({ memberLabel: "本人が選んだ家族" });
    expect(FAMILY_DOMAINS).toContain("health");
    expect(verifyDocumentCitation(doc, review.items[0]!.citation)).toBe(true);
    expect(review.member.sourceIdentityVerified).toBe(false);
    expect(index.annotateFamilyCitation({ kind: "user_annotation", citation: review.items[0]!.citation, domain: "other" }).kind).toBe("user_annotation");
    expect(review).not.toHaveProperty("actions"); expect(review).not.toHaveProperty("receipt");
  });
  it("pages all input offline and preserves negation/relative text", () => {
    const first = run([file, "--limit", "2", "--include-evidence"]);
    expect(first.status).toBe(0); expect(first.stderr).toBe("");
    const a = JSON.parse(first.stdout);
    expect(a.coverage.nextOffset).toBe(2); expect(a.items[0].flags).toContain("relative_date");
    const next = run([file, "--offset", "2", "--include-evidence"]);
    const b = JSON.parse(next.stdout);
    expect(b.items[0].flags).toContain("negated");
    expect(b.items[1].domains).toEqual(["other"]); expect(b.coverage.hasMore).toBe(false);
  });
  it("requires explicit quotation output", () => {
    const result = run([file]); expect(result.status).not.toBe(0); expect(result.stdout).toBe("");
  });
  it("supports canonical pages and domain/topic cue filters", () => {
    const input = resolve(directory, "canonical.json");
    writeFileSync(input, JSON.stringify({ id: "paged", pages: [{ pageNumber: 9, text: source }] }));
    const result = run([input, "--canonical-json", "--domain", "school", "--topic", "deadline", "--include-evidence"]);
    expect(result.status).toBe(0); const review = JSON.parse(result.stdout);
    expect(review.items).toHaveLength(1); expect(review.items[0].citation.page).toBe(9);
  });
  it.each(["invalid-utf8", "pdf", "malformed", "limit", "domain", "topic", "offset"])("fails closed without private content for %s", kind => {
    const input = resolve(directory, kind === "pdf" ? "PRIVATE.pdf" : "PRIVATE.txt");
    writeFileSync(input, kind === "invalid-utf8" ? Buffer.from([0xff]) : "SYNTHETIC_PRIVATE_CONTENT");
    const args = [input, "--include-evidence"];
    if (kind === "malformed") args.push("--canonical-json");
    if (kind === "limit") args.push("--limit", "51");
    if (kind === "domain") args.push("--domain", "execute");
    if (kind === "topic") args.push("--topic", "execute");
    if (kind === "offset") args.push("--offset", "-1");
    const result = run(args); expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).toContain("FAMILY_REVIEW_INVALID");
    expect(result.stderr).not.toContain("SYNTHETIC_PRIVATE_CONTENT"); expect(result.stderr).not.toContain("PRIVATE.txt");
  });
});
