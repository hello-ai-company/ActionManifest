import type { AssistanceCompanion } from "./assistance-types.js";
import { assertReference, assertTimestamp, referenceKey, requireValue, stableJson, stringValue } from "./assistance-common.js";

type ObjectValue = Record<string, unknown>;
function object(value: unknown, allowed: string[], required: string[] = []): ObjectValue {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "INVALID_COMPANION", "Expected an object");
  const record = value as ObjectValue;
  requireValue(Object.keys(record).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(record, key)), "INVALID_COMPANION", "Unknown or missing companion fields");
  return record;
}
function array(value: unknown, max = 4096): unknown[] { requireValue(Array.isArray(value) && value.length <= max, "INVALID_COMPANION", "Invalid bounded array"); return value; }
function enumeration(value: unknown, allowed: string[]): void { requireValue(typeof value === "string" && allowed.includes(value), "INVALID_COMPANION", "Unknown enum value"); }
function strings(value: unknown): void { array(value, 128).forEach(v => stringValue(v, "text", 512)); }
function ref(value: unknown, actionRequired = false): void {
  const row = object(value, ["source_id", "source_hash", "action_id"], ["source_id", "source_hash", ...(actionRequired ? ["action_id"] : [])]);
  assertReference(row as unknown as Parameters<typeof assertReference>[0], actionRequired);
}
function quotes(value: unknown): void {
  for (const item of array(value, 32)) {
    const quote = object(item, ["source_id", "source_hash", "action_id", "text", "page", "bbox", "section", "source_reference"], ["source_id", "source_hash", "text"]);
    assertReference(quote as unknown as Parameters<typeof assertReference>[0]); stringValue(quote.text, "quote", 4096);
    if (quote.page !== undefined) requireValue(Number.isSafeInteger(quote.page) && Number(quote.page) > 0, "INVALID_COMPANION", "Invalid page");
    for (const key of ["section", "source_reference"]) if (quote[key] !== undefined) stringValue(quote[key], key, 4096);
    if (quote.bbox !== undefined) {
      const bbox = object(quote.bbox, ["x", "y", "width", "height"], ["x", "y", "width", "height"]);
      requireValue(Object.values(bbox).every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1), "INVALID_COMPANION", "Invalid normalized bbox");
      requireValue(Number(bbox.x) + Number(bbox.width) <= 1.000001 && Number(bbox.y) + Number(bbox.height) <= 1.000001, "INVALID_COMPANION", "Bbox is out of bounds");
    }
  }
}
/** Strict new companion wire validation; this never replaces frozen Manifest/AJV ingress. */
export function validateAssistanceCompanion(input: unknown): AssistanceCompanion {
  // Bound recursion and reject null/undefined, cyclic and non-JSON values before field validation.
  const seen = new Set<object>(); let count = 0;
  const walk = (value: unknown, depth = 0): void => {
    requireValue(++count <= 200000 && depth <= 16, "INPUT_LIMIT", "Companion exceeds complexity budget");
    requireValue(value !== null && value !== undefined, "INVALID_COMPANION", "Optional fields must be omitted, not null");
    if (typeof value === "object") {
      requireValue(!seen.has(value), "INVALID_COMPANION", "Cyclic objects are not valid wire JSON");
      seen.add(value); Object.values(value).forEach(child => walk(child, depth + 1)); seen.delete(value);
    } else requireValue(typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)), "INVALID_COMPANION", "Non-JSON value");
  };
  walk(input);
  const envelope = object(input, ["protocol_version", "ledger_id", "revision", "changes", "review_queue", "evaluations"], ["protocol_version", "ledger_id", "revision", "changes", "review_queue", "evaluations"]);
  requireValue(envelope.protocol_version === "0.1.0", "UNSUPPORTED_PROTOCOL", "Unsupported assistance protocol");
  stringValue(envelope.ledger_id, "ledger_id");
  requireValue(Number.isSafeInteger(envelope.revision) && Number(envelope.revision) >= 0, "INVALID_COMPANION", "Invalid revision");
  const changeIds = new Set<string>();
  const openRefs = new Set<string>();
  const inactiveRefs = new Map<string, string>();
  for (const value of array(envelope.changes)) {
    const row = object(value, ["change_id", "kind", "before", "after", "quotes", "changed_fields", "reason_codes", "target_resolution", "status"], ["change_id", "kind", "after", "quotes", "changed_fields", "reason_codes", "target_resolution", "status"]);
    stringValue(row.change_id, "change_id"); requireValue(!changeIds.has(row.change_id), "INVALID_COMPANION", "Duplicate change ID"); changeIds.add(row.change_id);
    enumeration(row.kind, ["corrects", "cancels", "possible_change"]); enumeration(row.target_resolution, ["exact", "ambiguous", "unresolved"]); enumeration(row.status, ["open", "resolved", "dismissed"]);
    if (row.before !== undefined) ref(row.before, true); ref(row.after); quotes(row.quotes); strings(row.reason_codes);
    requireValue((row.quotes as unknown[]).length > 0, "INVALID_COMPANION", "Changes require source quotes");
    const before = row.before as Parameters<typeof referenceKey>[0] | undefined;
    const after = row.after as Parameters<typeof referenceKey>[0];
    requireValue((row.quotes as ObjectValue[]).some(q => q.source_id === after.source_id && q.source_hash === after.source_hash), "INVALID_COMPANION", "Change lacks a quote from its new source");
    if (row.target_resolution === "exact") requireValue(before && row.kind !== "possible_change" && (row.kind !== "corrects" || after.action_id !== undefined), "INVALID_COMPANION", "Exact changes require their explicit action identities");
    if (row.status === "open") { if (before) openRefs.add(referenceKey(before)); if (after.action_id) openRefs.add(referenceKey(after)); }
    if (row.status === "resolved" && before) {
      const key = referenceKey(before);
      requireValue(!inactiveRefs.has(key), "INVALID_COMPANION", "One action has multiple applied replacements");
      inactiveRefs.set(key, row.kind === "cancels" ? "cancelled" : "superseded");
    }
    if (row.status === "resolved") requireValue(row.target_resolution === "exact" && row.before !== undefined && row.kind !== "possible_change", "INVALID_COMPANION", "Unresolved changes cannot be applied");
    for (const value of array(row.changed_fields, 6)) {
      const field = object(value, ["field", "before_value", "after_value"], ["field"]);
      enumeration(field.field, ["title", "object", "modality", "temporal.date", "temporal.datetime", "conditions"]);
      requireValue(field.before_value !== undefined || field.after_value !== undefined, "INVALID_COMPANION", "Changed field has no values");
      for (const key of ["before_value", "after_value"]) if (field[key] !== undefined) requireValue(typeof field[key] === "string" && field[key].length <= 8192, "INVALID_COMPANION", "Invalid field value");
    }
  }
  const itemIds = new Set<string>();
  for (const value of array(envelope.review_queue)) {
    const row = object(value, ["item_id", "fingerprint", "action_ref", "change_id", "field", "profile_id", "reason_codes", "question", "quotes", "status"], ["item_id", "fingerprint", "field", "reason_codes", "question", "quotes", "status"]);
    stringValue(row.item_id, "item_id"); stringValue(row.fingerprint, "fingerprint");
    requireValue(/^[a-f0-9]{64}$/.test(row.fingerprint) && row.item_id === `review_${row.fingerprint.slice(0, 24)}` && !itemIds.has(row.item_id), "INVALID_COMPANION", "Invalid or duplicate review identity"); itemIds.add(row.item_id);
    if (row.action_ref !== undefined) ref(row.action_ref, true);
    if (row.change_id !== undefined) { stringValue(row.change_id, "change_id"); requireValue(changeIds.has(row.change_id), "INVALID_COMPANION", "Review refers to an absent change"); }
    if (row.profile_id !== undefined) stringValue(row.profile_id, "profile_id");
    stringValue(row.field, "field"); stringValue(row.question, "question", 4096); strings(row.reason_codes); quotes(row.quotes); enumeration(row.status, ["open", "resolved", "dismissed"]);
  }
  const evaluations = new Set<string>();
  for (const value of array(envelope.evaluations, 32768)) {
    const row = object(value, ["action_ref", "profile_id", "state", "reason_codes", "missing_facts", "workflow_state", "trust", "ready_for_use", "valid_until", "date_state", "calendar_eligible"], ["action_ref", "profile_id", "state", "reason_codes", "missing_facts", "workflow_state", "trust", "ready_for_use", "date_state", "calendar_eligible"]);
    ref(row.action_ref, true); stringValue(row.profile_id, "profile_id");
    enumeration(row.state, ["applies", "not_applicable", "unknown"]); enumeration(row.workflow_state, ["active", "superseded", "cancelled"]); enumeration(row.trust, ["ready", "review_required", "blocked"]); enumeration(row.date_state, ["exact", "approximate", "relative", "unknown", "none"]);
    strings(row.reason_codes); strings(row.missing_facts);
    if (row.valid_until !== undefined) assertTimestamp(row.valid_until);
    requireValue(typeof row.ready_for_use === "boolean" && typeof row.calendar_eligible === "boolean", "INVALID_COMPANION", "Readiness must be boolean");
    const id = stableJson([row.action_ref, row.profile_id]); requireValue(!evaluations.has(id), "INVALID_COMPANION", "Duplicate action/profile evaluation"); evaluations.add(id);
    const actionKey = referenceKey(row.action_ref as Parameters<typeof referenceKey>[0]);
    if (openRefs.has(actionKey)) requireValue(row.ready_for_use === false && row.calendar_eligible === false && row.state !== "applies", "INVALID_COMPANION", "An open revision must hold its referenced actions");
    if (inactiveRefs.has(actionKey)) requireValue(row.workflow_state === inactiveRefs.get(actionKey) && row.ready_for_use === false && row.calendar_eligible === false, "INVALID_COMPANION", "Applied revision contradicts action lifecycle");
    if (row.ready_for_use) requireValue(row.workflow_state === "active" && row.trust === "ready" && row.state === "applies", "INVALID_COMPANION", "Readiness contradicts trust/applicability");
    if (row.calendar_eligible) requireValue(row.ready_for_use === true && row.date_state === "exact", "INVALID_COMPANION", "Calendar eligibility requires exact ready evidence");
  }
  return structuredClone(input) as AssistanceCompanion;
}
export function acceptAssistanceSnapshot(current: AssistanceCompanion | undefined, input: unknown): AssistanceCompanion {
  const next = validateAssistanceCompanion(input);
  if (current) {
    validateAssistanceCompanion(current);
    requireValue(current.ledger_id === next.ledger_id, "LEDGER_CONFLICT", "Select/reset a different ledger explicitly");
    requireValue(next.revision >= current.revision, "STALE_SNAPSHOT", "An older snapshot cannot replace newer confirmation state");
    if (next.revision === current.revision) requireValue(stableJson(next) === stableJson(current), "SNAPSHOT_COLLISION", "Same revision has different content");
  }
  return next;
}
