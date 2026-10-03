import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AGENT_LIMITS, agentFailure, readAgentStdin, runAgentRequest } from "./agent.js";

const base = new URL("../../../packages/consumer/fixtures/matoe-v02/", import.meta.url);
const golden = () => JSON.parse(readFileSync(new URL("golden.json", base), "utf8"));
const request = JSON.parse(readFileSync(new URL("request.json", base), "utf8"));
const source = { id: request.sourceId, text: request.ocrText };
const extract = { protocol_version: "1", operation: "extract", source };
const verify = () => ({ protocol_version: "1", operation: "verify", source, manifest: golden() });

describe("offline agent protocol", () => {
  it("uses existing deterministic pipeline without network and exposes no execution authority", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("MUST_NOT_CALL"));
    try {
      const result = await runAgentRequest(extract);
      expect(result.manifest.schema_version).toBe("0.2.0");
      expect(result.classification.counts.ready).toBe(4);
      expect(result.authority).toEqual({ execution_allowed: false, human_approval_required: true, issuer_authenticated: false });
      expect(result.manifest.actions.every(action => action.evidence.every(item => !item.page && !item.bbox))).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("recomputes tampered verification and blocks unsupported evidence without filtering", async () => {
    const input = verify();
    input.manifest.actions[0].evidence[0].text = "SYNTHETIC_FABRICATED_QUOTE";
    const result = await runAgentRequest(input);
    expect(result.classification.actions[0]?.disposition).toBe("blocked");
    expect(result.manifest.receipt?.verification?.actions?.[0]?.passed).toBe(false);
    expect(result.manifest.actions).toHaveLength(4);
    expect(result.manifest.actions[0]?.evidence[0]?.text).toBe("SYNTHETIC_FABRICATED_QUOTE");
    expect(result.manifest.actions[2]).toEqual(input.manifest.actions[2]);
  });
  it("retains mixed failures and all temporal/role/conditional information", async () => {
    const input = verify();
    input.manifest = JSON.parse(readFileSync(new URL("mixed.json", base), "utf8"));
    const result = await runAgentRequest(input);
    expect(result.classification.counts).toEqual({ ready: 3, blocked: 1, review_required: 0 });
    expect(result.manifest.actions[2]?.temporal?.alternatives).toEqual(input.manifest.actions[2].temporal.alternatives);
  });
  it("has stable input fingerprints for reordered keys, with exact source differences preserved", async () => {
    const one = await runAgentRequest(extract);
    const two = await runAgentRequest({ source: { text: source.text, id: source.id }, operation: "extract", protocol_version: "1" });
    const three = await runAgentRequest({ ...extract, source: { ...source, text: source.text + "\n" } });
    expect(one.input_fingerprint).toBe(two.input_fingerprint);
    expect(one.manifest.actions).toEqual(two.manifest.actions);
    expect(one.input_fingerprint).not.toBe(three.input_fingerprint);
  });
  it.each([null, [], {}, { ...extract, operation: "pay" }, { ...extract, protocol_version: "2" },
    { ...extract, provider: "openai" }, { ...extract, source: { ...source, text: "\ud800" } },
    { ...extract, source: { ...source, text: " " } }, { ...extract, source: { ...source, hash: "x" } }])("refuses malformed or unauthorized operations", async input => {
    await expect(runAgentRequest(input)).rejects.toMatchObject({ code: "AGENT_REQUEST_INVALID" });
  });
  it.each(["0.3.0", "constructor", "__proto__", "0.1.0"])("rejects unsupported schema %s", async version => {
    const input = verify(); input.manifest.schema_version = version;
    await expect(runAgentRequest(input)).rejects.toMatchObject({ code: "AGENT_SCHEMA_INVALID" });
  });
  it.each(["accepted", "exported", "rejected"])("cannot import approval state %s", async status => {
    const input = verify(); input.manifest.actions[0].status = status;
    await expect(runAgentRequest(input)).rejects.toMatchObject({ code: "AGENT_LIFECYCLE_INVALID" });
  });
  it.each(["hash", "id", "evidence"])("rejects source identity mismatch %s", async field => {
    const input = verify();
    if (field === "hash") input.manifest.source.hash = "0".repeat(64);
    if (field === "id") input.manifest.source.id = "different";
    if (field === "evidence") input.manifest.actions[0].evidence[0].source_id = "different";
    await expect(runAgentRequest(input)).rejects.toMatchObject({ code: "AGENT_SOURCE_MISMATCH" });
  });
  it("refuses unknown provenance and duplicate action IDs", async () => {
    const input = verify(); input.manifest.receipt.extraction.provider = "unknown";
    await expect(runAgentRequest(input)).rejects.toMatchObject({ code: "AGENT_PROVENANCE_INVALID" });
    const duplicate = verify(); duplicate.manifest.actions[1].id = duplicate.manifest.actions[0].id;
    await expect(runAgentRequest(duplicate)).rejects.toMatchObject({ code: "AGENT_SCHEMA_INVALID" });
  });
  it("bounds text, nesting and action count", async () => {
    await expect(runAgentRequest({ ...extract, source: { ...source, text: "x".repeat(AGENT_LIMITS.textScalars + 1) } })).rejects.toMatchObject({ code: "AGENT_INPUT_TOO_LARGE" });
    let nested: unknown = null; for (let i = 0; i < 30; i++) nested = { nested };
    await expect(runAgentRequest(nested)).rejects.toMatchObject({ code: "AGENT_INPUT_TOO_LARGE" });
    const many = verify(); many.manifest.actions = Array.from({ length: 257 }, (_, index) => ({ ...many.manifest.actions[0], id: String(index) }));
    await expect(runAgentRequest(many)).rejects.toMatchObject({ code: "AGENT_INPUT_TOO_LARGE" });
  });
  it("bounds wire bytes and rejects invalid UTF-8 while accepting fragmented UTF-8", async () => {
    async function* tooLarge() { yield Buffer.alloc(AGENT_LIMITS.requestBytes + 1); }
    async function* invalid() { yield Buffer.from([0xff]); }
    async function* split() { for (const byte of Buffer.from(JSON.stringify(extract))) yield Buffer.from([byte]); }
    await expect(readAgentStdin(tooLarge())).rejects.toMatchObject({ code: "AGENT_INPUT_TOO_LARGE" });
    await expect(readAgentStdin(invalid())).rejects.toMatchObject({ code: "AGENT_REQUEST_INVALID" });
    expect(await readAgentStdin(split())).toEqual(extract);
  });
  it("sanitizes failures and distinguishes retryable unexpected failure", () => {
    const result = agentFailure(new Error("SYNTHETIC_PRIVATE_MARKER"));
    expect(result.error).toEqual({ code: "AGENT_PIPELINE_FAILED", message: "Agent analysis failed", retryable: true });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_MARKER");
  });
});
