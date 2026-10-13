import type { AssistanceState } from "./assistance-types.js";
import { ASSISTANCE_LIMITS, appendEvent, assertState, requireValue, stableJson } from "./assistance-common.js";
import { createAssistanceState, decideAssistanceChange, proposeAssistanceChange } from "./assistance-ledger.js";
import { registerAssistanceDocument } from "./assistance-ingress.js";

/** Restore only local persisted state; recompute manifest trust and replay every transition.
 * JSON/state hashes provide integrity binding, not issuer authentication or an audit signature.
 */
export function restoreAssistanceState(serialized: string): AssistanceState {
  requireValue(typeof serialized === "string" && Buffer.byteLength(serialized, "utf8") <= 8 * 1024 * 1024, "INPUT_LIMIT", "Persisted assistance state exceeds limit");
  const input = JSON.parse(serialized) as AssistanceState;
  assertState(input);
  requireValue(input.documents.length <= ASSISTANCE_LIMITS.documents && new Set(input.documents.map(d => d.source_id)).size === input.documents.length, "INVALID_STATE", "Duplicate stored source identities");
  let state = createAssistanceState(input.ledger_id);
  for (const event of input.events) {
    requireValue(event && typeof event === "object", "INVALID_STATE", "Invalid history event");
    switch (event.type) {
      case "document_registered": {
        const doc = input.documents.find(d => d.source_id === event.source_id && d.source_hash === event.source_hash);
        requireValue(doc && Array.isArray(doc.actions), "INVALID_STATE", "History references an absent source");
        const previousRevision = state.revision;
        state = registerAssistanceDocument(state, doc.manifest, doc.canonical_text, doc.source_id, doc.scope_key,
          doc.actions.filter(a => a.subject_key !== undefined).map(a => ({ action_id: a.action.id, subject_key: a.subject_key! })), state.revision);
        requireValue(state.revision === previousRevision + 1 && stableJson(state.documents.at(-1)) === stableJson(doc), "INVALID_STATE", "Stored trust/actions differ from verified source ingress");
        break;
      }
      case "change_proposed": state = proposeAssistanceChange(state, event.proposal, state.revision); break;
      case "change_decided": state = decideAssistanceChange(state, event.change_id, event.decision, event.confirmed_by_user, state.revision); break;
      case "projection_refreshed":
        requireValue(typeof event.fingerprint === "string" && /^[a-f0-9]{64}$/.test(event.fingerprint), "INVALID_STATE", "Invalid projection fingerprint");
        state = appendEvent(state, { type: "projection_refreshed", fingerprint: event.fingerprint }); break;
      case "review_decided":
        requireValue(typeof event.fingerprint === "string" && /^[a-f0-9]{64}$/.test(event.fingerprint) && event.item_id === `review_${event.fingerprint.slice(0, 24)}` && ["resolved", "dismissed"].includes(event.status), "INVALID_STATE", "Invalid review history");
        state = appendEvent(state, { type: "review_decided", item_id: event.item_id, fingerprint: event.fingerprint, status: event.status }); break;
      default: requireValue(false, "INVALID_STATE", "Unknown history event");
    }
  }
  requireValue(stableJson(state) === stableJson(input), "INVALID_STATE", "Stored snapshot does not match its replayed history");
  return state;
}
