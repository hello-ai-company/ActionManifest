import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDocumentEvidenceIndex, verifyDocumentCitation } from "@actionmanifest/core";

const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/index.js");
const directory = mkdtempSync(resolve(tmpdir(), "document-query-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const run = (args: string[]) => spawnSync(process.execPath, [cli, "ask-document", ...args], {
  encoding: "utf8", env: { ...process.env, ACTIONMAN_PROVIDER: "openai", OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1/must-not-call" },
});
const source = "遠足の参加費は１，５００円です。\nただし雨天時のみ返金します。\n申込期限は10月20日です。";
const file = resolve(directory, "notice.txt"); writeFileSync(file, source);

describe("built document question API and CLI", () => {
  it("exposes the index API through package exports with exact citations", () => {
    const document = { id: "built", text: source };
    const index = createDocumentEvidenceIndex(document);
    const result = index.query({ kind: "cost", text: "遠足" });
    expect(verifyDocumentCitation(document, result.evidence[0]!)).toBe(true);
    expect(index.explainCitation(result.evidence[0]!)).toHaveLength(2);
  });
  it("answers without a provider and retains adjacent conditions", () => {
    const result = run([file, "--kind", "cost", "--subject", "遠足", "--include-evidence"]);
    expect(result.status).toBe(0); expect(result.stderr).toBe("");
    const answer = JSON.parse(result.stdout);
    expect(answer.mode).toBe("local-extractive");
    expect(answer.evidence[0].quote).toContain("１，５００円");
    expect(answer.context[1].quote).toContain("雨天時のみ");
    expect(answer.actions).toBeUndefined();
  });
  it("requires an explicit source-output option", () => {
    const result = run([file, "--kind", "cost"]);
    expect(result.status).not.toBe(0); expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("１，５００円");
  });
  it("supports canonical page provenance", () => {
    const input = resolve(directory, "canonical.json");
    writeFileSync(input, JSON.stringify({ id: "paged", pages: [{ pageNumber: 7, text: source }] }));
    const result = run([input, "--canonical-json", "--kind", "deadline", "--include-evidence"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).evidence[0].page).toBe(7);
  });
  it("returns an explicit unknown answer successfully", () => {
    const result = run([file, "--kind", "contact", "--include-evidence"]);
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout).status).toBe("not_found");
  });
  it.each(["invalid-utf8", "pdf", "malformed", "limit", "kind"])("fails closed without private-content echo for %s", kind => {
    const input = resolve(directory, kind === "pdf" ? "PRIVATE.pdf" : "PRIVATE.txt");
    writeFileSync(input, kind === "invalid-utf8" ? Buffer.from([0xff]) : "SYNTHETIC_PRIVATE_CONTENT");
    const args = [input, "--include-evidence"];
    if (kind === "malformed") args.push("--canonical-json");
    if (kind === "limit") args.push("--limit", "51");
    if (kind === "kind") args.push("--kind", "execute");
    const result = run(args);
    expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).toContain("DOCUMENT_QUERY_INVALID");
    expect(result.stderr).not.toContain("SYNTHETIC_PRIVATE_CONTENT");
    expect(result.stderr).not.toContain("PRIVATE.txt");
  });
});
