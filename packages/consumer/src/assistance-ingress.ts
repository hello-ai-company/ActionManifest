import type { ActionBinding, AssistanceDocument, AssistanceState } from "./assistance-types.js";
import { classifyManifest } from "./classify.js";
import { prepareMatoeV02Manifest } from "./matoe-v02.js";
import { registerSnapshot } from "./assistance-ledger.js";
import { requireValue, stringValue } from "./assistance-common.js";

/** Every public ingress keeps the existing frozen-schema/source/receipt gate. */
export function registerAssistanceDocument(
  state: AssistanceState,
  input: unknown,
  canonicalSourceText: string,
  expectedSourceId: string,
  scopeKey: string,
  bindings: ActionBinding[],
  expectedRevision: number,
): AssistanceState {
  const manifest = prepareMatoeV02Manifest(input, canonicalSourceText, expectedSourceId);
  stringValue(scopeKey, "scope_key");
  requireValue(Array.isArray(bindings) && bindings.length <= manifest.actions.length && new Set(bindings.map(b => b.action_id)).size === bindings.length, "INVALID_BINDING", "Bindings must identify unique known actions");
  const ids = new Set(manifest.actions.map(a => a.id));
  for (const binding of bindings) { stringValue(binding.subject_key, "subject_key"); requireValue(ids.has(binding.action_id), "INVALID_BINDING", "Binding action is absent from the manifest"); }
  const subjects = new Map(bindings.map(b => [b.action_id, b.subject_key]));
  const doc: AssistanceDocument = {
    source_id: manifest.source.id, source_hash: manifest.source.hash!, scope_key: scopeKey,
    canonical_text: canonicalSourceText, manifest: structuredClone(manifest),
    actions: classifyManifest(manifest).actions.map(a => ({ action: a.action, trust: a.disposition, ...(subjects.has(a.action.id) ? { subject_key: subjects.get(a.action.id)! } : {}) })),
  };
  return registerSnapshot(state, doc, expectedRevision);
}
