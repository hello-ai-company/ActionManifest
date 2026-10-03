import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/index.js");
const example = readFileSync(resolve(root, "examples/agent-extract.json"), "utf8");
const run = (input: string, args = ["agent", "--stdin-json"]) => spawnSync(process.execPath, [cli, ...args], {
  input, encoding: "utf8", env: { ...process.env, ACTIONMAN_PROVIDER: "openai", OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1/must-not-call" },
});

describe("built agent entry protocol", () => {
  it("performs actual offline extraction and re-verification with unchanged proposals", () => {
    const extracted = run(example);
    expect(extracted.status).toBe(0); expect(extracted.stderr).toBe("");
    const result = JSON.parse(extracted.stdout);
    expect(result.ok).toBe(true);
    expect(result.manifest.schema_version).toBe("0.2.0");
    const verified = run(JSON.stringify({ protocol_version: "1", operation: "verify", source: JSON.parse(example).source, manifest: result.manifest }));
    expect(verified.status).toBe(0); expect(verified.stderr).toBe("");
    expect(JSON.parse(verified.stdout).manifest.actions).toEqual(result.manifest.actions);
    expect(result.authority.execution_allowed).toBe(false);
  });
  it("returns exit 2 and a full successful-analysis payload for failed evidence", () => {
    const manifest = JSON.parse(run(example).stdout).manifest;
    manifest.actions[0].evidence[0].text = "FABRICATED_SYNTHETIC_QUOTE";
    const result = run(JSON.stringify({ protocol_version: "1", operation: "verify", source: JSON.parse(example).source, manifest }));
    expect(result.status).toBe(2); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, classification: { counts: { blocked: 1 } } });
  });
  it.each(["INVALID_JSON_PRIVATE_MARKER", JSON.stringify({ ...JSON.parse(example), operation: "send" })])("emits one fixed machine-readable error without input leakage", input => {
    const result = run(input);
    expect(result.status).toBe(1); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "AGENT_REQUEST_INVALID", retryable: false } });
    expect(result.stdout).not.toContain("PRIVATE_MARKER");
  });
  it.each([{ args: ["agent"] }, { args: ["agent", "--stdin-json", "--execute"] }, { args: ["agent", "--stdin-json", "unexpected"] }])("refuses unsupported CLI arguments with JSON", ({ args }) => {
    const result = run(example, args);
    expect(result.status).toBe(1); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "AGENT_REQUEST_INVALID" } });
  });
});
