import type { Action } from "@actionmanifest/core";
import type { AssistanceDocument, AssistanceState } from "../src/assistance-types.js";
import { hashText } from "../src/assistance-common.js";
import { createAssistanceState, registerSnapshot } from "../src/assistance-ledger.js";

/** Synthetic internal snapshots for pure ledger tests; never a production ingress substitute. */
export function notice(id: string, date: string, options: { subject?: string; scope?: string; text?: string; action?: Partial<Action>; trust?: "ready" | "blocked" | "review_required" } = {}): AssistanceDocument {
  const text = options.text ?? `参加確認票を${date}までに提出してください。`;
  const hash = hashText(text);
  const action: Action = { id: "act_001", kind: "submit", title: "参加確認票を提出する", object: "参加確認票", modality: "required", actor: { certainty: "unknown" }, temporal: { type: "exact", date, raw_text: date }, evidence: [{ source_id: id, text }], inference: "explicit", status: "verified", ...options.action };
  return { source_id: id, source_hash: hash, scope_key: options.scope ?? "school-A", canonical_text: text, manifest: { schema_version: "0.2.0", source: { id, hash }, actions: [action] }, actions: [{ action, trust: options.trust ?? "ready", ...(options.subject !== undefined ? { subject_key: options.subject } : {}) }] };
}
export function withDocuments(...docs: AssistanceDocument[]): AssistanceState {
  return docs.reduce((state, doc) => registerSnapshot(state, doc, state.revision), createAssistanceState("synthetic-ledger"));
}
export const localProfile = { profile_id: "local-child-A", scope_key: "school-A", facts: [] };
export const NOW = "2026-10-10T00:00:00Z";
