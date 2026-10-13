import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ActionManifestError, sha256Hex } from "@actionmanifest/core";
import { AGENT_BATCH_LIMITS, agentBatchFailure, readAgentBatchStdin, runAgentBatch } from "./agent-batch.js";

const base = new URL("../../../packages/consumer/fixtures/matoe-v02/", import.meta.url);
const original = JSON.parse(readFileSync(new URL("request.json", base), "utf8"));
const source = { id: original.sourceId, text: original.ocrText };
const extract = () => ({ protocol_version: "1", operation: "extract", source: structuredClone(source) });
const verify = () => ({ protocol_version: "1", operation: "verify", source: structuredClone(source), manifest: JSON.parse(readFileSync(new URL("golden.json", base), "utf8")) });
const batch = (...requests: unknown[]) => ({ batch_version: "1", items: requests.map((request, i) => ({ item_id: `item-${i}`, request })) });

describe("offline bounded multi-document batch", () => {
  it("uses only offline pipeline, retains ordered isolated outcomes, and aggregates classifications", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_FORBIDDEN"));
    try {
      const other = extract(); other.source.id = "other-document";
      const report = await runAgentBatch(batch(extract(), other, { operation: "pay" }));
      expect(report.ok).toBe(false);
      expect(report.summary).toEqual({ items: 3, analyzed: 2, failed: 1, ready: 8, blocked: 0, review_required: 0, manifest_fatal: 0 });
      expect(report.items.map(item => item.item_id)).toEqual(["item-0", "item-1", "item-2"]);
      expect(report.items[2]?.result).toMatchObject({ ok: false, error: { code: "AGENT_REQUEST_INVALID" } });
      expect(report.items[0]?.source).toEqual({ id: source.id, text_sha256: sha256Hex(source.text) });
      expect(report.authority).toEqual({ execution_allowed: false, human_approval_required: true, issuer_authenticated: false });
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it("flags repeated/conflicting source IDs without merging or silently reusing results", async () => {
    const changed = extract(); changed.source.text += "\n";
    const report = await runAgentBatch(batch(extract(), extract(), changed));
    expect(report.summary.analyzed).toBe(3);
    expect(report.source_reviews).toEqual([{ code: "SOURCE_ID_CONFLICT", source_id: source.id, item_ids: ["item-0", "item-1", "item-2"], source_hashes: [sha256Hex(source.text), sha256Hex(changed.source.text)].sort() }]);
    expect(report.items[0]?.request_fingerprint).toBe(report.items[1]?.request_fingerprint);
    expect(report.items[0]?.request_fingerprint).not.toBe(report.items[2]?.request_fingerprint);
    const duplicate = await runAgentBatch(batch(extract(), extract()));
    expect(duplicate.source_reviews[0]?.code).toBe("REPEATED_SOURCE");
  });
  it("binds failed items to their claimed exact source and fingerprint without trusting their receipts", async () => {
    const wrong = verify(); wrong.manifest.source.hash = "0".repeat(64);
    const tampered = verify(); tampered.manifest.actions[0].evidence[0].text = "FABRICATED_EVIDENCE";
    const report = await runAgentBatch(batch(wrong, tampered));
    expect(report.items[0]).toMatchObject({ source: { id: source.id, text_sha256: sha256Hex(source.text) }, result: { ok: false, error: { code: "AGENT_SOURCE_MISMATCH" } } });
    expect(report.items[0]?.request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.summary.blocked).toBe(1);
    const result = report.items[1]!.result;
    expect(result.ok && result.manifest.actions).toHaveLength(4);
    expect(result.ok && result.manifest.receipt?.verification?.actions?.[0]?.passed).toBe(false);
  });
  it("clones all items before the first asynchronous analysis and keeps deterministic correlation", async () => {
    const input = batch(extract(), extract());
    const copy = structuredClone(input);
    const pending = runAgentBatch(input);
    input.items[1]!.item_id = "mutated";
    (input.items[1]!.request as ReturnType<typeof extract>).source.text = "mutated";
    const result = await pending;
    const expected = await runAgentBatch(copy);
    expect(result.input_fingerprint).toBe(expected.input_fingerprint);
    expect(result.items.map(item => ({ id: item.item_id, fingerprint: item.request_fingerprint }))).toEqual(expected.items.map(item => ({ id: item.item_id, fingerprint: item.request_fingerprint })));
    expect(result.items[1]?.source?.text_sha256).toBe(sha256Hex(source.text));
    const reordered = { items: copy.items, batch_version: "1" };
    expect((await runAgentBatch(reordered)).input_fingerprint).toBe(result.input_fingerprint);
  });
  it.each([null, [], {}, { batch_version: "2", items: [] }, { ...batch(extract()), provider: "openai" },
    { batch_version: "1", items: [{ item_id: "same", request: {} }, { item_id: "same", request: {} }] },
    { batch_version: "1", items: [{ item_id: "\u001b[31m", request: {} }] },
    { batch_version: "1", items: [{ item_id: "valid", request: {}, extra: 1 }] },
    batch({ x: "\ud800" }), batch({ x: Infinity }), batch({ x: undefined }), batch(new Date()), batch(new Map()),
  ])("rejects malformed envelope / non-JSON input", async value => {
    await expect(runAgentBatch(value)).rejects.toMatchObject({ code: "AGENT_BATCH_INVALID" });
  });
  it("rejects cycles, getters, custom serialization, symbols and sparse arrays without calling hooks", async () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const getter = vi.fn(() => extract());
    const custom = vi.fn(() => extract());
    const values = [cyclic, Object.defineProperty({}, "source", { get: getter, enumerable: true }), { toJSON: custom }, { [Symbol("hidden")]: 1 }, new Array(2)];
    for (const value of values) await expect(runAgentBatch(batch(value))).rejects.toMatchObject({ code: "AGENT_BATCH_INVALID" });
    expect(getter).not.toHaveBeenCalled(); expect(custom).not.toHaveBeenCalled();
  });
  it("bounds empty/large batches, nesting, node count, and aggregate UTF-8 bytes", async () => {
    await expect(runAgentBatch(batch())).rejects.toMatchObject({ code: "AGENT_BATCH_LIMIT" });
    await expect(runAgentBatch(batch(...Array.from({ length: 17 }, extract)))).rejects.toMatchObject({ code: "AGENT_BATCH_LIMIT" });
    let deep: unknown = null; for (let i = 0; i < 30; i++) deep = { child: deep };
    await expect(runAgentBatch(batch(deep))).rejects.toMatchObject({ code: "AGENT_BATCH_LIMIT" });
    await expect(runAgentBatch(batch(Array.from({ length: AGENT_BATCH_LIMITS.nodes }, () => null)))).rejects.toMatchObject({ code: "AGENT_BATCH_LIMIT" });
    await expect(runAgentBatch(batch("日".repeat(700_000)))).rejects.toMatchObject({ code: "AGENT_BATCH_LIMIT" });
    // Escaped control characters expand when serialized, so serialized bytes are checked too.
    await expect(runAgentBatch(batch("\u0000".repeat(400_000)))).rejects.toMatchObject({ code: "AGENT_BATCH_LIMIT" });
  });
  it("handles inherited dangerous object keys as inert data", async () => {
    const value = JSON.parse('{"batch_version":"1","items":[{"item_id":"constructor","request":{"__proto__":{"polluted":true}}}]}');
    const result = await runAgentBatch(value);
    expect(result.items[0]?.item_id).toBe("constructor");
    expect(result.items[0]?.result.ok).toBe(false);
    expect(Object.hasOwn({}, "polluted")).toBe(false);
  });
  it("reads bounded fragmented UTF-8 and emits sanitized envelope errors", async () => {
    async function* split() { for (const byte of Buffer.from(JSON.stringify(batch(extract())))) yield Buffer.from([byte]); }
    async function* invalid() { yield Buffer.from([0xff]); }
    async function* huge() { yield Buffer.alloc(AGENT_BATCH_LIMITS.requestBytes + 1); }
    expect(await readAgentBatchStdin(split())).toEqual(batch(extract()));
    await expect(readAgentBatchStdin(invalid())).rejects.toMatchObject({ code: "AGENT_BATCH_INVALID" });
    await expect(readAgentBatchStdin(huge())).rejects.toMatchObject({ code: "AGENT_BATCH_LIMIT" });
    expect(JSON.stringify(agentBatchFailure(new Error("PRIVATE_SECRET")))).not.toContain("PRIVATE_SECRET");
    expect(agentBatchFailure(new ActionManifestError("constructor", "PRIVATE_SECRET"))).toMatchObject({ error: { code: "AGENT_BATCH_FAILED", retryable: false } });
  });
});
