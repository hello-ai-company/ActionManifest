import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const fixture = resolve(root, "packages/consumer/fixtures/matoe-v02");
const cli = resolve(root, "apps/cli/dist/index.js");
const directory = mkdtempSync(resolve(tmpdir(), "action-guidance-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const run = (args: string[]) => spawnSync(process.execPath, [cli, "explain", ...args], {
  encoding: "utf8", env: { ...process.env, ACTIONMAN_PROVIDER: "openai", OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1/must-not-call" },
});
const args = [resolve(fixture, "golden.json"), "--doc", resolve(fixture, "source.txt")];

describe("built offline explanation CLI", () => {
  it("prints a useful plain-text guide without silently selecting a provider", () => {
    const result = run(args); expect(result.status).toBe(0); expect(result.stderr).toBe("");
    expect(result.stdout).toContain("次にすること"); expect(result.stdout).toContain("表示専用");
    expect(result.stdout).toContain("本文は非表示");
  });
  it("has an explicit JSON report with no execution authority", () => {
    const result = run([...args, "--json"]); expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout); expect(report.counts.ready).toBe(4);
    expect(report.authority.execution_allowed).toBe(false);
    expect(report.actions.every((row: { evidence?: unknown }) => row.evidence === undefined)).toBe(true);
  });
  it("includes exact original quotes only when explicitly requested", () => {
    const result = run([...args, "--json", "--include-evidence"]); expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).actions[0].evidence).toEqual(JSON.parse(readFileSync(resolve(fixture, "golden.json"), "utf8")).actions[0].evidence);
  });
  it("reverifies a forged receipt and retains blocked candidates with exit 2", () => {
    const input = JSON.parse(readFileSync(resolve(fixture, "golden.json"), "utf8"));
    input.actions[0].evidence[0].text = "SYNTHETIC_PRIVATE_FABRICATION";
    const file = resolve(directory, "forged.json"); writeFileSync(file, JSON.stringify(input));
    const result = run([file, "--doc", resolve(fixture, "source.txt"), "--json"]);
    expect(result.status).toBe(2); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).actions[0].verification).toBe("blocked");
    expect(result.stdout).not.toContain("SYNTHETIC_PRIVATE_FABRICATION");
  });
  it.each(["malformed", "wrong-source", "invalid-utf8", "missing"])("returns a fixed nonsecret error for %s", kind => {
    const file = resolve(directory, `PRIVATE_PATH_${kind}.json`);
    const doc = resolve(directory, `PRIVATE_PATH_${kind}.txt`);
    if (kind !== "missing") writeFileSync(file, kind === "malformed" ? "SYNTHETIC_PRIVATE_CONTENT" : kind === "invalid-utf8" ? Buffer.from([0xff]) : readFileSync(resolve(fixture, "golden.json")));
    writeFileSync(doc, "SYNTHETIC_PRIVATE_WRONG_SOURCE");
    const result = run([file, "--doc", doc, "--json"]);
    expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).toContain("EXPLANATION_INPUT_INVALID");
    expect(result.stderr).not.toMatch(/PRIVATE_PATH|PRIVATE_CONTENT|PRIVATE_WRONG_SOURCE/);
  });
});
