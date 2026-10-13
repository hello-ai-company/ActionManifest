import { createHash } from "node:crypto";
import type { ActionReference, AssistanceDocument, AssistanceState, DocumentReference, SourceQuote } from "./assistance-types.js";

export const ASSISTANCE_LIMITS = Object.freeze({ documents: 64, actions: 2048, events: 4096, profiles: 16, facts: 128, rules: 64, depth: 8, sourceBytes: 262144, totalSourceBytes: 2097152 });
export class AssistanceError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "AssistanceError"; }
}
export function requireValue(ok: unknown, code: string, message: string): asserts ok {
  if (!ok) throw new AssistanceError(code, message);
}
export function stringValue(value: unknown, label: string, max = 256): asserts value is string {
  requireValue(typeof value === "string" && value.trim().length > 0 && value.length <= max, "INVALID_INPUT", `${label} must be a bounded nonempty string`);
}
export function assertTimestamp(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value), "INVALID_TIME", "Expected an ISO8601 timestamp with explicit offset");
  const date = value.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  requireValue(Number.isFinite(Date.parse(value)) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date, "INVALID_TIME", "Invalid calendar timestamp");
}
export function hashText(text: string): string { return createHash("sha256").update(text).digest("hex"); }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function fingerprint(value: unknown): string { return hashText(stableJson(value)); }
export function referenceKey(ref: DocumentReference): string {
  return JSON.stringify([ref.source_id, ref.source_hash, ref.action_id ?? ""]);
}
export function assertReference(ref: DocumentReference, actionRequired = false): void {
  requireValue(ref && typeof ref === "object", "INVALID_REFERENCE", "Source reference is required");
  stringValue(ref.source_id, "source_id");
  requireValue(typeof ref.source_hash === "string" && /^[a-f0-9]{64}$/.test(ref.source_hash), "INVALID_REFERENCE", "source_hash must be lowercase SHA-256");
  if (actionRequired || ref.action_id !== undefined) stringValue(ref.action_id, "action_id");
}
export function assertState(state: AssistanceState, expectedRevision?: number): void {
  stringValue(state?.ledger_id, "ledger_id");
  requireValue(state?.protocol_version === "0.1.0", "UNSUPPORTED_PROTOCOL", "Unsupported assistance protocol");
  requireValue(Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.events) && state.revision === state.events.length, "INVALID_STATE", "Invalid event revision");
  requireValue(Array.isArray(state.documents) && state.documents.length <= ASSISTANCE_LIMITS.documents && state.events.length <= ASSISTANCE_LIMITS.events, "INPUT_LIMIT", "Assistance state exceeds limits");
  if (expectedRevision !== undefined) requireValue(state.revision === expectedRevision, "REVISION_CONFLICT", "State changed; refresh before applying this decision");
}
export function appendEvent(state: AssistanceState, event: AssistanceState["events"][number]): AssistanceState {
  requireValue(state.events.length < ASSISTANCE_LIMITS.events, "INPUT_LIMIT", "Event limit reached; archive explicitly before adding history");
  const next = structuredClone(state);
  next.events.push(structuredClone(event));
  next.revision += 1;
  return next;
}
export function findDocument(state: AssistanceState, ref: DocumentReference): AssistanceDocument | undefined {
  return state.documents.find(d => d.source_id === ref.source_id && d.source_hash === ref.source_hash);
}
export function findAction(state: AssistanceState, ref: ActionReference): AssistanceDocument["actions"][number] | undefined {
  return findDocument(state, ref)?.actions.find(a => a.action.id === ref.action_id);
}
export function assertQuotes(state: AssistanceState, quotes: SourceQuote[], requiredSource?: DocumentReference): void {
  requireValue(Array.isArray(quotes) && quotes.length > 0 && quotes.length <= 32, "EVIDENCE_REQUIRED", "One to 32 source quotes are required");
  for (const quote of quotes) {
    assertReference(quote);
    stringValue(quote.text, "quote", 4096);
    const doc = findDocument(state, quote);
    requireValue(doc && doc.canonical_text.includes(quote.text), "EVIDENCE_UNSUPPORTED", "Quote must appear literally in the exact registered source");
    const quotedAction = quote.action_id !== undefined ? findAction(state, quote as ActionReference) : undefined;
    if (quote.action_id !== undefined) requireValue(quotedAction?.action.evidence.some(e => e.text === quote.text), "EVIDENCE_UNSUPPORTED", "Quote does not belong to its referenced action evidence");
    if (quote.page !== undefined) requireValue(Number.isSafeInteger(quote.page) && quote.page > 0, "INVALID_LOCATOR", "Invalid evidence page");
    // Locators must match a registered Action quote; document-only cancellation quotes omit geometry.
    if (quote.page !== undefined || quote.bbox !== undefined || quote.section !== undefined || quote.source_reference !== undefined) {
      const locators = (quotedAction ? quotedAction.action.evidence : doc.actions.flatMap(a => a.action.evidence)).filter(e => e.text === quote.text);
      requireValue(locators.some(e => ["page", "bbox", "section", "source_reference"].every(k =>
        stableJson(e[k as keyof typeof e]) === stableJson(quote[k as keyof SourceQuote]))), "INVALID_LOCATOR", "Locator was not preserved from registered evidence");
    }
  }
  if (requiredSource) requireValue(quotes.some(q => q.source_id === requiredSource.source_id && q.source_hash === requiredSource.source_hash), "EVIDENCE_REQUIRED", "The new source must support the proposed change");
}
export function quotesFor(doc: AssistanceDocument, actionId: string): SourceQuote[] {
  // Projection is bounded; the complete evidence remains in the immutable document.
  return (doc.actions.find(a => a.action.id === actionId)?.action.evidence ?? []).slice(0, 32).map(e => ({
    source_id: doc.source_id, source_hash: doc.source_hash, action_id: actionId, text: e.text,
    ...(e.page !== undefined ? { page: e.page } : {}), ...(e.bbox ? { bbox: structuredClone(e.bbox) } : {}),
    ...(e.section ? { section: e.section } : {}), ...(e.source_reference ? { source_reference: e.source_reference } : {}),
  }));
}
