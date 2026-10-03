import { ActionManifestError, assertCanonicalDocument, ensureSourceHash, sha256Hex, validateActionManifest, type ActionManifest } from "@actionmanifest/core";
import { classifyManifest, type ConsumerReport } from "@actionmanifest/consumer";
import { ActionExtractor, DeterministicProvider } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";

export const AGENT_LIMITS = Object.freeze({ requestBytes: 1_048_576, textBytes: 240_000, textScalars: 60_000, actions: 256, depth: 24 });
export type AgentRequest = { protocol_version: "1"; operation: "extract"; source: { id: string; text: string } }
  | { protocol_version: "1"; operation: "verify"; source: { id: string; text: string }; manifest: ActionManifest };
export interface AgentSuccess {
  protocol_version: "1";
  ok: true;
  operation: "extract" | "verify";
  /** Same exact input yields the same fingerprint, not an execution dedupe key. */
  input_fingerprint: string;
  manifest: ActionManifest;
  classification: ConsumerReport;
  authority: { execution_allowed: false; human_approval_required: true; issuer_authenticated: false };
}
const messages = {
  AGENT_REQUEST_INVALID: "Invalid agent request",
  AGENT_INPUT_TOO_LARGE: "Agent input exceeds the budget",
  AGENT_SCHEMA_INVALID: "Manifest must satisfy frozen schema 0.2.0",
  AGENT_SOURCE_MISMATCH: "Manifest source does not match the exact supplied source",
  AGENT_PROVENANCE_INVALID: "Matching extraction provenance is required",
  AGENT_LIFECYCLE_INVALID: "Only proposed or verified candidates can be reverified",
  AGENT_PIPELINE_FAILED: "Agent analysis failed",
} as const;
type ErrorCode = keyof typeof messages;
function refuse(code: ErrorCode): never { throw new ActionManifestError(code, messages[code]); }
const unicodeInvalid = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

function bound(value: unknown, depth = 0): void {
  if (depth > AGENT_LIMITS.depth) refuse("AGENT_INPUT_TOO_LARGE");
  if (typeof value === "string" && unicodeInvalid(value)) refuse("AGENT_REQUEST_INVALID");
  if (value && typeof value === "object") for (const child of Object.values(value)) bound(child, depth + 1);
}
function keys(value: unknown, expected: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)));
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)]));
  return value;
}

/** Local-only orchestration of existing extractor/verifier/consumer; never executes. */
export async function runAgentRequest(input: unknown): Promise<AgentSuccess> {
  bound(input);
  let serialized: string;
  try { serialized = JSON.stringify(input); } catch { refuse("AGENT_REQUEST_INVALID"); }
  if (!serialized) refuse("AGENT_REQUEST_INVALID");
  if (Buffer.byteLength(serialized, "utf8") > AGENT_LIMITS.requestBytes) refuse("AGENT_INPUT_TOO_LARGE");
  const operation = input && typeof input === "object" ? (input as Record<string, unknown>).operation : undefined;
  if ((operation !== "extract" && operation !== "verify")
    || !keys(input, operation === "verify" ? ["protocol_version", "operation", "source", "manifest"] : ["protocol_version", "operation", "source"])
    || input.protocol_version !== "1" || !keys(input.source, ["id", "text"])) refuse("AGENT_REQUEST_INVALID");
  const source = input.source;
  if (typeof source.id !== "string" || !source.id.trim() || Array.from(source.id).length > 256
    || typeof source.text !== "string" || !source.text.trim()) refuse("AGENT_REQUEST_INVALID");
  if (Buffer.byteLength(source.text, "utf8") > AGENT_LIMITS.textBytes || Array.from(source.text).length > AGENT_LIMITS.textScalars) refuse("AGENT_INPUT_TOO_LARGE");
  const doc = assertCanonicalDocument(ensureSourceHash({ id: source.id, text: source.text }));
  let candidate: ActionManifest;
  if (operation === "extract") {
    candidate = await new ActionExtractor(new DeterministicProvider(doc)).extract(doc);
  } else {
    try { candidate = structuredClone(validateActionManifest(input.manifest)); } catch { refuse("AGENT_SCHEMA_INVALID"); }
    if (candidate.schema_version !== "0.2.0") refuse("AGENT_SCHEMA_INVALID");
    if (candidate.source.id !== doc.id || candidate.source.hash !== doc.sourceHash
      || candidate.actions.some(action => action.evidence.some(evidence => evidence.source_id !== doc.id))) refuse("AGENT_SOURCE_MISMATCH");
    const provenance = candidate.receipt?.extraction;
    if (!provenance || provenance.schema_version !== candidate.schema_version
      || [provenance.provider, provenance.model, provenance.extractor_version].some(value => !value.trim() || value.trim().toLowerCase() === "unknown")) refuse("AGENT_PROVENANCE_INVALID");
    if (candidate.actions.some(action => !["proposed", "verified"].includes(action.status))) refuse("AGENT_LIFECYCLE_INVALID");
  }
  if (candidate.actions.length > AGENT_LIMITS.actions) refuse("AGENT_INPUT_TOO_LARGE");
  if (candidate.actions.some(action => !action.id.trim() || !action.title.trim())
    || new Set(candidate.actions.map(action => action.id)).size !== candidate.actions.length) refuse("AGENT_SCHEMA_INVALID");
  // Incoming verification is never trusted. Core verifier replaces its receipt;
  // failed Actions remain present and consumer policy blocks their use.
  const manifest = verifyManifest(candidate, doc).manifest;
  return {
    protocol_version: "1", ok: true, operation,
    input_fingerprint: sha256Hex(JSON.stringify(stable(input))), manifest,
    classification: classifyManifest(manifest),
    authority: { execution_allowed: false, human_approval_required: true, issuer_authenticated: false },
  };
}

export async function readAgentStdin(stream: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > AGENT_LIMITS.requestBytes) refuse("AGENT_INPUT_TOO_LARGE");
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { refuse("AGENT_REQUEST_INVALID"); }
}

export function agentFailure(error: unknown) {
  const code: ErrorCode = error instanceof ActionManifestError && Object.hasOwn(messages, error.code)
    ? error.code as ErrorCode : "AGENT_PIPELINE_FAILED";
  return { protocol_version: "1" as const, ok: false as const,
    error: { code, message: messages[code], retryable: code === "AGENT_PIPELINE_FAILED" },
    authority: { execution_allowed: false as const, human_approval_required: true as const, issuer_authenticated: false as const } };
}
