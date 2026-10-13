import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/index.js");
const example = JSON.parse(readFileSync(resolve(root, "examples/agent-extract.json"), "utf8"));
const batch = (requests: unknown[]) => JSON.stringify({ batch_version: "1", items: requests.map((request, i) => ({ item_id: `doc-${i}`, request })) });
const run = (input: string | Buffer, args = ["agent-batch", "--stdin-json"]) => spawnSync(process.execPath, [cli, ...args], {
  input, encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  env: { ...process.env, ACTIONMAN_PROVIDER: "openai", OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1/must-not-call" },
});

describe("built offline agent-batch command", () => {
  it("analyzes separate documents through built exports with correlated full results", () => {
    const other = structuredClone(example); other.source.id = "second-document";
    const result = run(batch([example, other]));
    expect(result.status).toBe(0); expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report.summary).toMatchObject({ items: 2, analyzed: 2, failed: 0 });
    expect(report.items[0].result.manifest.source.id).toBe(example.source.id);
    expect(report.items[1].result.manifest.source.id).toBe("second-document");
    expect(report.items[1].source.text_sha256).toBe(report.items[1].result.manifest.source.hash);
    expect(report.authority.execution_allowed).toBe(false);
  });
  it("returns exit 2 and retains good results when another document fails", () => {
    const result = run(batch([{ ...example, operation: "send" }, example]));
    expect(result.status).toBe(2); expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report.items[0].result.error.code).toBe("AGENT_REQUEST_INVALID");
    expect(report.items[1].result.ok).toBe(true);
    expect(report.summary).toMatchObject({ analyzed: 1, failed: 1 });
  });
  it("returns exit 2 for source identity review even when all items analyze", () => {
    const result = run(batch([example, example]));
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, source_reviews: [{ code: "REPEATED_SOURCE" }] });
  });
  it.each(["PRIVATE_INPUT_MARKER", Buffer.from([0xff]), JSON.stringify({ batch_version: "1", items: [] })])("rejects malformed requests with fixed JSON and no input leakage", input => {
    const result = run(input);
    expect(result.status).toBe(1); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).ok).toBe(false); expect(result.stdout).not.toContain("PRIVATE_INPUT_MARKER");
  });
  it.each([[], ["--execute"], ["--stdin-json", "--help"], ["--stdin-json", "--provider", "openai"], ["--stdin-json", "--version"], ["--stdin-json", "PRIVATE_FLAG_MARKER"]].map(flags => ({ flags })))("preflights machine flags without Commander output", ({ flags }) => {
    const result = run(batch([example]), ["agent-batch", ...flags]);
    expect(result.status).toBe(1); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).error.code).toBe("AGENT_BATCH_INVALID");
    expect(result.stdout).not.toContain("PRIVATE_FLAG_MARKER");
  });
  it("keeps human-only help available", () => {
    const result = run("", ["agent-batch", "--help"]);
    expect(result.status).toBe(0); expect(result.stdout).toContain("--stdin-json");
  });
});
