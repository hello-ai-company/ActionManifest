import type { ActionReference, AssistanceDocument, AssistanceState, ChangeCard, ChangeProposal, ChangedField, TargetResolution } from "./assistance-types.js";
import { ASSISTANCE_LIMITS, appendEvent, assertQuotes, assertReference, assertState, findAction, findDocument, fingerprint, hashText, quotesFor, referenceKey, requireValue, stableJson, stringValue } from "./assistance-common.js";

export function createAssistanceState(ledgerId: string): AssistanceState {
  stringValue(ledgerId, "ledger_id");
  return { protocol_version: "0.1.0", ledger_id: ledgerId, revision: 0, documents: [], events: [] };
}

/** Internal ingress for snapshots already produced by the frozen-manifest gate. */
export function registerSnapshot(state: AssistanceState, doc: AssistanceDocument, expectedRevision: number): AssistanceState {
  assertState(state, expectedRevision);
  assertReference(doc); stringValue(doc.scope_key, "scope_key");
  requireValue(typeof doc.canonical_text === "string" && doc.canonical_text.trim().length > 0 && Buffer.byteLength(doc.canonical_text, "utf8") <= ASSISTANCE_LIMITS.sourceBytes, "INPUT_LIMIT", "Canonical source is empty or too large");
  requireValue(hashText(doc.canonical_text) === doc.source_hash, "SOURCE_HASH_MISMATCH", "Snapshot hash does not bind its canonical text");
  requireValue(doc.manifest.source.id === doc.source_id && doc.manifest.source.hash === doc.source_hash, "SOURCE_HASH_MISMATCH", "Snapshot manifest source does not match");
  const old = state.documents.find(d => d.source_id === doc.source_id);
  if (old) {
    requireValue(stableJson(old) === stableJson(doc), "SOURCE_ID_COLLISION", "A source ID is immutable; register a new document revision ID");
    return structuredClone(state);
  }
  requireValue(state.documents.length < ASSISTANCE_LIMITS.documents, "INPUT_LIMIT", "Document limit reached");
  requireValue(state.documents.reduce((n, d) => n + d.actions.length, doc.actions.length) <= ASSISTANCE_LIMITS.actions, "INPUT_LIMIT", "Action limit reached");
  requireValue(state.documents.reduce((n, d) => n + Buffer.byteLength(d.canonical_text, "utf8"), Buffer.byteLength(doc.canonical_text, "utf8")) <= ASSISTANCE_LIMITS.totalSourceBytes, "INPUT_LIMIT", "Total source text limit reached");
  requireValue(new Set(doc.actions.map(a => a.action.id)).size === doc.actions.length, "DUPLICATE_ACTION", "Action IDs must be unique in a document");
  for (const stored of doc.actions) {
    stringValue(stored.action.id, "action_id");
    if (stored.subject_key !== undefined) stringValue(stored.subject_key, "subject_key");
    requireValue(["ready", "review_required", "blocked"].includes(stored.trust), "INVALID_TRUST", "Unknown trust disposition");
    requireValue(stored.action.evidence.length > 0 && stored.action.evidence.every(e => e.source_id === doc.source_id && doc.canonical_text.includes(e.text)), "EVIDENCE_UNSUPPORTED", "Stored actions require literal source-bound quotes");
  }
  const next = appendEvent(state, { type: "document_registered", source_id: doc.source_id, source_hash: doc.source_hash });
  next.documents.push(structuredClone(doc));
  return next;
}

export function workflowStates(state: AssistanceState): Map<string, "active" | "superseded" | "cancelled"> {
  const statuses = new Map<string, "active" | "superseded" | "cancelled">();
  for (const doc of state.documents) for (const a of doc.actions) statuses.set(referenceKey({ ...doc, action_id: a.action.id }), "active");
  const last = new Map<string, { decision: string; index: number }>();
  state.events.forEach((event, index) => { if (event.type === "change_decided") last.set(event.change_id, { decision: event.decision, index }); });
  const applied = [...last].filter(([, v]) => v.decision === "apply").sort((a, b) => a[1].index - b[1].index);
  for (const [id] of applied) {
    const event = state.events.find(e => e.type === "change_proposed" && e.proposal.change_id === id);
    if (event?.type === "change_proposed" && event.proposal.before) statuses.set(referenceKey(event.proposal.before), event.proposal.kind === "cancels" ? "cancelled" : "superseded");
  }
  return statuses;
}

/** Current exact-binding candidates, independent of a caller's optional hint array. */
export function changeTargetReferences(state: AssistanceState, proposal: ChangeProposal): ActionReference[] {
  if (!proposal.subject_key) return [];
  const states = workflowStates(state);
  return state.documents.filter(d => d.scope_key === proposal.scope_key).flatMap(d => d.actions.filter(a =>
    a.subject_key === proposal.subject_key && referenceKey({ ...d, action_id: a.action.id }) !== referenceKey(proposal.after) &&
    states.get(referenceKey({ ...d, action_id: a.action.id })) === "active").map(a => ({ source_id: d.source_id, source_hash: d.source_hash, action_id: a.action.id })));
}

function resolution(state: AssistanceState, proposal: ChangeProposal): TargetResolution {
  if ((proposal.target_candidates?.length ?? 0) > 1) return "ambiguous";
  if (proposal.kind === "possible_change" || !proposal.before || !proposal.subject_key) return "unresolved";
  const beforeDoc = findDocument(state, proposal.before);
  const afterDoc = findDocument(state, proposal.after);
  const before = findAction(state, proposal.before);
  if (!beforeDoc || !afterDoc || !before || before.subject_key !== proposal.subject_key || beforeDoc.scope_key !== proposal.scope_key || afterDoc.scope_key !== proposal.scope_key) return "unresolved";
  if (proposal.kind === "corrects") {
    if (!proposal.after.action_id) return "unresolved";
    const after = findAction(state, proposal.after as ActionReference);
    if (!after || after.subject_key !== proposal.subject_key || after.action.kind !== before.action.kind) return "unresolved";
  }
  const candidates = changeTargetReferences(state, proposal);
  return candidates.length > 1 ? "ambiguous" : "exact";
}

export function proposeAssistanceChange(state: AssistanceState, proposal: ChangeProposal, expectedRevision: number): AssistanceState {
  assertState(state, expectedRevision);
  stringValue(proposal.change_id, "change_id"); stringValue(proposal.scope_key, "scope_key");
  requireValue(["corrects", "cancels", "possible_change"].includes(proposal.kind), "INVALID_CHANGE", "Unknown change kind");
  assertReference(proposal.after);
  requireValue(Boolean(findDocument(state, proposal.after)) && (proposal.after.action_id === undefined || Boolean(findAction(state, proposal.after as ActionReference))), "SOURCE_UNKNOWN", "New source/action must be registered first");
  if (proposal.before) {
    assertReference(proposal.before, true);
    requireValue(Boolean(findAction(state, proposal.before)), "SOURCE_UNKNOWN", "The old action must be registered first");
    requireValue(proposal.before.source_id !== proposal.after.source_id, "INVALID_CHANGE", "Cross-document changes require distinct source IDs");
  }
  if (proposal.subject_key !== undefined) stringValue(proposal.subject_key, "subject_key");
  if (proposal.target_candidates !== undefined) {
    requireValue(Array.isArray(proposal.target_candidates) && proposal.target_candidates.length <= 32, "INPUT_LIMIT", "Too many target candidates");
    proposal.target_candidates.forEach(r => { assertReference(r, true); requireValue(Boolean(findAction(state, r)), "SOURCE_UNKNOWN", "Target candidates must reference registered actions"); });
    requireValue(new Set(proposal.target_candidates.map(referenceKey)).size === proposal.target_candidates.length, "INVALID_CHANGE", "Duplicate candidates cannot establish ambiguity");
  }
  assertQuotes(state, proposal.quotes, proposal.after);
  const old = state.events.find(e => e.type === "change_proposed" && e.proposal.change_id === proposal.change_id);
  if (old?.type === "change_proposed") {
    requireValue(stableJson(old.proposal) === stableJson(proposal), "CHANGE_ID_COLLISION", "Change IDs are immutable");
    return structuredClone(state);
  }
  return appendEvent(state, { type: "change_proposed", proposal });
}

function changedFields(state: AssistanceState, proposal: ChangeProposal, exact: boolean): ChangedField[] {
  if (!proposal.before || !proposal.after.action_id || !exact) return [];
  const before = findAction(state, proposal.before)?.action;
  const after = findAction(state, proposal.after as ActionReference)?.action;
  if (!before || !after) return [];
  const pairs: Array<[ChangedField["field"], string | undefined, string | undefined]> = [
    ["title", before.title, after.title], ["object", before.object, after.object], ["modality", before.modality, after.modality],
    ["temporal.date", before.temporal?.date, after.temporal?.date], ["temporal.datetime", before.temporal?.datetime, after.temporal?.datetime],
    ["conditions", before.conditions?.join(" / "), after.conditions?.join(" / ")],
  ];
  return pairs.filter(([, a, b]) => a !== b).map(([field, a, b]) => ({ field, ...(a !== undefined ? { before_value: a } : {}), ...(b !== undefined ? { after_value: b } : {}) }));
}

export function changeCards(state: AssistanceState): ChangeCard[] {
  assertState(state);
  return state.events.filter(e => e.type === "change_proposed").map(event => {
    const proposal = event.proposal;
    const decision = [...state.events].reverse().find(e => e.type === "change_decided" && e.change_id === proposal.change_id);
    const status = decision?.type === "change_decided" && decision.decision !== "reopen" ? decision.decision === "apply" ? "resolved" : "dismissed" : "open";
    // Applied decisions preserve their confirmed identity even after their target is no longer active.
    const target_resolution = status === "resolved" ? "exact" : resolution(state, proposal);
    const reason_codes = status === "resolved" ? ["REVISION_APPLIED"] : status === "dismissed" ? ["REVISION_DISMISSED"] : [target_resolution === "exact" ? "CONFIRM_REVISION_LINK" : target_resolution === "ambiguous" ? "TARGET_AMBIGUOUS" : "TARGET_UNRESOLVED"];
    return { change_id: proposal.change_id, kind: proposal.kind, ...(proposal.before ? { before: structuredClone(proposal.before) } : {}), after: structuredClone(proposal.after), quotes: structuredClone(proposal.quotes), changed_fields: changedFields(state, proposal, target_resolution === "exact"), reason_codes, target_resolution, status };
  });
}

export function decideAssistanceChange(state: AssistanceState, changeId: string, decision: "apply" | "dismiss" | "reopen", confirmedByUser: boolean, expectedRevision: number): AssistanceState {
  assertState(state, expectedRevision);
  requireValue(confirmedByUser === true, "CONFIRMATION_REQUIRED", "A recorded explicit user decision is required");
  requireValue(["apply", "dismiss", "reopen"].includes(decision), "INVALID_DECISION", "Unknown decision");
  const event = state.events.find(e => e.type === "change_proposed" && e.proposal.change_id === changeId);
  requireValue(event?.type === "change_proposed", "CHANGE_UNKNOWN", "Change is unknown");
  const proposal = event.proposal;
  const current = changeCards(state).find(c => c.change_id === changeId)!;
  if ((decision === "apply" && current.status === "resolved") || (decision === "dismiss" && current.status === "dismissed") || (decision === "reopen" && current.status === "open")) return structuredClone(state);
  const states = workflowStates(state);
  if (decision === "apply") {
    requireValue(current.status === "open" && current.target_resolution === "exact" && proposal.before && proposal.kind !== "possible_change", "TARGET_UNRESOLVED", "Only an open, exact, explicitly bound change can apply");
    requireValue(states.get(referenceKey(proposal.before)) === "active", "STALE_CHANGE", "Target is no longer active; review the current revision");
    if (proposal.kind === "corrects") {
      const replacement = findAction(state, proposal.after as ActionReference);
      requireValue(replacement?.trust === "ready" && states.get(referenceKey(proposal.after)) === "active", "REPLACEMENT_UNTRUSTED", "Replacement must be active and independently verified");
    }
  } else if (decision === "reopen" && current.status === "resolved") {
    // Do not undo an ancestor underneath a later accepted revision.
    const touched = new Set([proposal.before && referenceKey(proposal.before), referenceKey(proposal.after)].filter(Boolean));
    const dependent = changeCards(state).some(c => c.change_id !== changeId && c.status === "resolved" && c.before && touched.has(referenceKey(c.before)));
    requireValue(!dependent, "REVISION_DEPENDENCY", "Undo dependent revisions first");
  } else requireValue(current.status !== "resolved", "REVISION_DEPENDENCY", "Reopen an applied change before dismissing it");
  return appendEvent(state, { type: "change_decided", change_id: changeId, decision, confirmed_by_user: true });
}

/** Read-only exact-binding suggestions. Missing mappings never become automatic links. */
export function suggestDocumentChanges(state: AssistanceState, newSourceId: string): ChangeProposal[] {
  assertState(state);
  const doc = state.documents.find(d => d.source_id === newSourceId);
  requireValue(doc, "SOURCE_UNKNOWN", "New document is not registered");
  const states = workflowStates(state);
  return doc.actions.flatMap(stored => {
    if (!stored.subject_key) return [];
    const candidates = state.documents.filter(d => d.scope_key === doc.scope_key && d.source_id !== doc.source_id).flatMap(d => d.actions.filter(a => a.subject_key === stored.subject_key && states.get(referenceKey({ ...d, action_id: a.action.id })) === "active").map(a => ({ doc: d, stored: a })));
    if (!candidates.length) return [];
    const before = candidates.length === 1 ? { source_id: candidates[0]!.doc.source_id, source_hash: candidates[0]!.doc.source_hash, action_id: candidates[0]!.stored.action.id } : undefined;
    const after = { source_id: doc.source_id, source_hash: doc.source_hash, action_id: stored.action.id };
    const refs = candidates.map(c => ({ source_id: c.doc.source_id, source_hash: c.doc.source_hash, action_id: c.stored.action.id }));
    const seed = { before, after, scope_key: doc.scope_key, subject_key: stored.subject_key };
    return [{ change_id: `chg_${fingerprint(seed).slice(0, 24)}`, kind: "corrects" as const, ...(before ? { before } : {}), after, scope_key: doc.scope_key, subject_key: stored.subject_key, target_candidates: refs.slice(0, 32), quotes: [...quotesFor(doc, stored.action.id).slice(0, 16), ...candidates.flatMap(c => quotesFor(c.doc, c.stored.action.id)).slice(0, 16)] }];
  });
}
