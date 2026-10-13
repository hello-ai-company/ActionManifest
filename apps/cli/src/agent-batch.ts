import { ActionManifestError, sha256Hex } from "@actionmanifest/core";
import { agentFailure, runAgentRequest, type AgentRequest, type AgentSuccess } from "./agent.js";

/** Offline analysis budgets, never execution or provider budgets. */
export const AGENT_BATCH_LIMITS = Object.freeze({ requestBytes: 2_097_152, items: 16, depth: 28, nodes: 100_000 });
export interface AgentBatchRequest {
  batch_version: "1";
  items: Array<{ item_id: string; request: AgentRequest }>;
}
type ItemResult = { item_id: string; request_fingerprint: string; source?: { id: string; text_sha256: string }; result: AgentSuccess | ReturnType<typeof agentFailure> };
export interface AgentBatchReport {
  batch_version: "1";
  /** True means every item was analyzed, not that its actions passed verification. */
  ok: boolean;
  input_fingerprint: string;
  summary: { items: number; analyzed: number; failed: number; ready: number; review_required: number; blocked: number; manifest_fatal: number };
  /** Identity conflicts require human review. Neither documents nor actions are merged. */
  source_reviews: Array<{ code: "REPEATED_SOURCE" | "SOURCE_ID_CONFLICT"; source_id: string; item_ids: string[]; source_hashes: string[] }>;
  items: ItemResult[];
  authority: { execution_allowed: false; human_approval_required: true; issuer_authenticated: false };
}
const messages = {
  AGENT_BATCH_INVALID: "Invalid batch request",
  AGENT_BATCH_LIMIT: "Batch request exceeds the budget",
  AGENT_BATCH_FAILED: "Batch analysis failed",
} as const;
type BatchCode = keyof typeof messages;
function refuse(code: BatchCode): never { throw new ActionManifestError(code, messages[code]); }
const invalidUnicode = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
const exactKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));

/** Reject non-JSON objects, getters, cycles, excessive depth, and byte budgets before awaiting.
 * Own data descriptors prevent toJSON/getter hooks from being invoked by serialization.
 */
function snapshot(input: unknown): unknown {
  let nodes = 0;
  let stringBytes = 0;
  const seen = new Set<object>();
  function inspect(value: unknown, depth: number): void {
    if (++nodes > AGENT_BATCH_LIMITS.nodes || depth > AGENT_BATCH_LIMITS.depth) refuse("AGENT_BATCH_LIMIT");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number") { if (!Number.isFinite(value)) refuse("AGENT_BATCH_INVALID"); return; }
    if (typeof value === "string") {
      stringBytes += Buffer.byteLength(value, "utf8");
      if (stringBytes > AGENT_BATCH_LIMITS.requestBytes) refuse("AGENT_BATCH_LIMIT");
      if (invalidUnicode(value)) refuse("AGENT_BATCH_INVALID");
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) refuse("AGENT_BATCH_INVALID");
    if (Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)
      && !(Object.getPrototypeOf(value) === null && !Array.isArray(value))) refuse("AGENT_BATCH_INVALID");
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) refuse("AGENT_BATCH_INVALID");
    const keys = Object.keys(descriptors);
    if (Array.isArray(value) && (keys.length !== value.length + 1 || keys.some(key => key !== "length" && !/^(0|[1-9]\d*)$/.test(key)))) refuse("AGENT_BATCH_INVALID");
    for (const key of keys) {
      if (Array.isArray(value) && key === "length") continue;
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable || key === "toJSON") refuse("AGENT_BATCH_INVALID");
      inspect(key, depth + 1); inspect(descriptor.value, depth + 1);
    }
    seen.delete(value);
  }
  inspect(input, 0);
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > AGENT_BATCH_LIMITS.requestBytes) refuse("AGENT_BATCH_LIMIT");
  return JSON.parse(serialized);
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}

/** Sequential bounded analysis. A bad item does not discard good items; no side effects. */
export async function runAgentBatch(input: unknown): Promise<AgentBatchReport> {
  const request = snapshot(input);
  if (!exactKeys(request, ["batch_version", "items"]) || request.batch_version !== "1" || !Array.isArray(request.items)) refuse("AGENT_BATCH_INVALID");
  if (!request.items.length || request.items.length > AGENT_BATCH_LIMITS.items) refuse("AGENT_BATCH_LIMIT");
  const ids = new Set<string>();
  for (const item of request.items) {
    if (!exactKeys(item, ["item_id", "request"]) || typeof item.item_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(item.item_id)
      || ids.has(item.item_id)) refuse("AGENT_BATCH_INVALID");
    ids.add(item.item_id);
  }
  const report: AgentBatchReport = {
    batch_version: "1", ok: true, input_fingerprint: sha256Hex(JSON.stringify(stable(request))),
    summary: { items: request.items.length, analyzed: 0, failed: 0, ready: 0, review_required: 0, blocked: 0, manifest_fatal: 0 },
    source_reviews: [], items: [], authority: { execution_allowed: false, human_approval_required: true, issuer_authenticated: false },
  };
  const sources = new Map<string, { item_ids: string[]; hashes: Set<string> }>();
  for (const item of request.items as Array<{ item_id: string; request: unknown }>) {
    // Record valid source identities even if that item's manifest later fails validation.
    const source = item.request && typeof item.request === "object" && !Array.isArray(item.request) && Object.hasOwn(item.request, "source")
      ? (item.request as Record<string, unknown>).source : undefined;
    if (exactKeys(source, ["id", "text"]) && typeof source.id === "string" && source.id.trim() && source.id.length <= 512 && typeof source.text === "string") {
      const entry = sources.get(source.id) ?? { item_ids: [], hashes: new Set<string>() };
      entry.item_ids.push(item.item_id); entry.hashes.add(sha256Hex(source.text)); sources.set(source.id, entry);
    }
    const identity = { item_id: item.item_id, request_fingerprint: sha256Hex(JSON.stringify(stable(item.request))),
      ...(source && typeof source === "object" && "id" in source && "text" in source && typeof source.id === "string" && typeof source.text === "string"
        ? { source: { id: source.id, text_sha256: sha256Hex(source.text) } } : {}) };
    try {
      const result = await runAgentRequest(item.request);
      report.items.push({ ...identity, result });
      report.summary.analyzed++;
      for (const disposition of ["ready", "review_required", "blocked"] as const) report.summary[disposition] += result.classification.counts[disposition];
      if (result.classification.manifestFatal) report.summary.manifest_fatal++;
    } catch (error) {
      report.items.push({ ...identity, result: agentFailure(error) });
      report.summary.failed++; report.ok = false;
    }
  }
  for (const [source_id, source] of sources) if (source.item_ids.length > 1) report.source_reviews.push({
    code: source.hashes.size > 1 ? "SOURCE_ID_CONFLICT" : "REPEATED_SOURCE", source_id, item_ids: source.item_ids, source_hashes: [...source.hashes].sort(),
  });
  return report;
}

export async function readAgentBatchStdin(stream: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = []; let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.byteLength;
    if (bytes > AGENT_BATCH_LIMITS.requestBytes) refuse("AGENT_BATCH_LIMIT");
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { refuse("AGENT_BATCH_INVALID"); }
}
export function agentBatchFailure(error: unknown) {
  const code: BatchCode = error instanceof ActionManifestError && Object.hasOwn(messages, error.code) ? error.code as BatchCode : "AGENT_BATCH_FAILED";
  return { batch_version: "1" as const, ok: false as const, error: { code, message: messages[code], retryable: false },
    authority: { execution_allowed: false as const, human_approval_required: true as const, issuer_authenticated: false as const } };
}
