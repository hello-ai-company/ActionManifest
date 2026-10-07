import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@actionmanifest/core";
import { classifyManifest, prepareMatoeV02Manifest } from "@actionmanifest/consumer";

const cli = resolve(import.meta.dirname, "../../../apps/cli/dist/index.js");
const source = { id: "synthetic-recovery", text: "2026年10月15日までに参加票を提出してください。\n" };
const request = { protocol_version: "1", operation: "extract", source };
const authority = { execution_allowed: false, human_approval_required: true, issuer_authenticated: false };
const env = { ...process.env, ACTIONMAN_PROVIDER: "openai", OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1/must-not-call" };
let cwd: string;

function run(input: string | Buffer, args = ["agent", "--stdin-json"]) {
  return new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env });
    const out: Buffer[] = [], err: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error("Synthetic CLI probe timed out")); }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({ code, signal, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    child.stdin.on("error", reject);
    child.stdin.end(input);
  });
}

describe("built proposal boundaries: retry, recovery and isolation", () => {
  beforeAll(async () => { cwd = await mkdtemp(join(tmpdir(), "actionmanifest-recovery-")); });
  afterEach(async () => { expect(await readdir(cwd)).toEqual([]); });
  afterAll(async () => { await rm(cwd, { recursive: true, force: true }); });

  it("repeated identical requests keep proposal identities and grant no execution or persisted approval", async () => {
    const first = await run(JSON.stringify(request)), retry = await run(JSON.stringify(request));
    expect(first.code).toBe(0); expect(retry.code).toBe(0);
    expect(first.stderr).toBe(""); expect(retry.stderr).toBe("");
    const one = JSON.parse(first.stdout), two = JSON.parse(retry.stdout);
    expect(two.input_fingerprint).toBe(one.input_fingerprint);
    expect(two.manifest.actions).toEqual(one.manifest.actions);
    expect(two.manifest.source).toEqual(one.manifest.source);
    expect(one.authority).toEqual(authority); expect(two.authority).toEqual(authority);
    expect(two.manifest.actions.every((action: { status: string }) => action.status === "verified")).toBe(true);
  });

  it("refused and blocked requests leave no usable partial success and do not poison the next request", async () => {
    const good = JSON.parse((await run(JSON.stringify(request))).stdout);
    const invalid = await run('{"SYNTHETIC_PRIVATE_MARKER":');
    expect(invalid.code).toBe(1); expect(invalid.stderr).toBe("");
    const failure = JSON.parse(invalid.stdout);
    expect(failure).toMatchObject({ ok: false, error: { code: "AGENT_REQUEST_INVALID", retryable: false }, authority });
    expect(failure.manifest).toBeUndefined();
    expect(invalid.stdout).not.toContain("SYNTHETIC_PRIVATE_MARKER");
    const tampered = structuredClone(good.manifest);
    tampered.actions[0].evidence[0].text = "FABRICATED_SYNTHETIC_EVIDENCE";
    const blocked = await run(JSON.stringify({ ...request, operation: "verify", manifest: tampered }));
    expect(blocked.code).toBe(2);
    expect(JSON.parse(blocked.stdout)).toMatchObject({ ok: true, classification: { counts: { blocked: 1 } }, authority });
    const retry = await run(JSON.stringify(request));
    expect(retry.code).toBe(0); expect(retry.stderr).toBe("");
    expect(JSON.parse(retry.stdout).manifest.actions).toEqual(good.manifest.actions);
  });

  it("terminating a just-spawned process with unfinished stdin produces no receipt and a fresh process recovers", async () => {
    const stopped = await new Promise<{ code: number | null; signal: string | null; stdout: string }>((resolveResult, reject) => {
      const child = spawn(process.execPath, [cli, "agent", "--stdin-json"], { cwd, env });
      let stdout = "";
      child.stdout.on("data", chunk => { stdout += chunk.toString(); });
      child.on("error", reject);
      child.stdin.on("error", () => { /* termination may close the unfinished input */ });
      child.on("spawn", () => { child.stdin.write('{"protocol_version":"1",'); child.kill("SIGTERM"); });
      child.on("close", (code, signal) => resolveResult({ code, signal, stdout }));
    });
    expect(stopped.signal).toBe("SIGTERM"); expect(stopped.stdout).toBe("");
    const recovered = await run(JSON.stringify(request));
    expect(recovered.code).toBe(0); expect(JSON.parse(recovered.stdout).authority).toEqual(authority);
  });

  it("parallel Matoe workers keep exact identity, hash and evidence isolated and failures recover without fallback", async () => {
    const other = { id: "synthetic-parallel", text: "2026年11月20日までに申込書を提出してください。\n" };
    const args = ["analyze-matoe", "--stdin-json"];
    const results = await Promise.all([source, other].map(item => run(JSON.stringify({ sourceId: item.id, ocrText: item.text }), args)));
    for (const [index, result] of results.entries()) {
      const item = [source, other][index]!;
      expect(result.code).toBe(0); expect(result.stderr).toBe("");
      const wire = prepareMatoeV02Manifest(JSON.parse(result.stdout), item.text, item.id);
      expect(wire.source.hash).toBe(sha256Hex(item.text));
      expect(wire.actions).toHaveLength(1);
      expect(wire.actions[0]!.evidence[0]!.source_id).toBe(item.id);
      expect(classifyManifest(wire).counts).toEqual({ ready: 1, blocked: 0, review_required: 0 });
    }
    const invalid = await run(Buffer.from([0xff]), args);
    expect(invalid.code).toBe(1); expect(invalid.stdout).toBe("");
    expect(JSON.parse(invalid.stderr)).toMatchObject({ error: { code: "MATOE_REQUEST_INVALID" } });
    const retry = await run(JSON.stringify({ sourceId: source.id, ocrText: source.text }), args);
    expect(retry.code).toBe(0); expect(retry.stderr).toBe("");
    expect(JSON.parse(retry.stdout).actions).toEqual(JSON.parse(results[0]!.stdout).actions);
  });
});
