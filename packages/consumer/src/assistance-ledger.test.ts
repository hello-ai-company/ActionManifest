import { describe, expect, it } from "vitest";
import { createAssistanceState, registerSnapshot, proposeAssistanceChange, decideAssistanceChange, suggestDocumentChanges, workflowStates, changeCards } from "./assistance-ledger.js";
import { hashText, referenceKey } from "./assistance-common.js";
import { notice, withDocuments } from "../test/assistance-fixtures.js";
import type { ChangeProposal } from "./assistance-types.js";

function correction() {
  const first = notice("old", "2026-10-05", { subject: "permission-form" });
  const second = notice("new", "2026-10-12", { subject: "permission-form" });
  const state = withDocuments(first, second);
  const proposal = suggestDocumentChanges(state, "new")[0]!;
  return { first, second, proposal, state: proposeAssistanceChange(state, proposal, state.revision) };
}

describe("append-only document revision ledger", () => {
  it("requires a stable explicit ledger identity", () => { expect(() => createAssistanceState("")).toThrow(); });
  it("registers immutable snapshots idempotently without mutating inputs", () => {
    const doc = notice("old", "2026-10-05"); const original = createAssistanceState("ledger");
    const state = registerSnapshot(original, doc, 0); doc.actions[0]!.action.title = "changed outside";
    expect(original.revision).toBe(0); expect(state.documents[0]?.actions[0]?.action.title).not.toBe("changed outside");
    expect(registerSnapshot(state, state.documents[0]!, state.revision)).toEqual(state);
  });
  it("rejects changed bytes under the same source identity", () => {
    const state = withDocuments(notice("old", "2026-10-05"));
    expect(() => registerSnapshot(state, notice("old", "2026-10-12"), state.revision)).toThrow(/immutable/);
  });
  it("rejects bad source hashes before making history", () => {
    const doc = notice("old", "2026-10-05"); doc.source_hash = "a".repeat(64);
    expect(() => registerSnapshot(createAssistanceState("ledger"), doc, 0)).toThrow();
  });
  it("suggests exact subject bindings but does not apply without confirmation", () => {
    const { state, proposal } = correction();
    expect(changeCards(state)[0]).toMatchObject({ target_resolution: "exact", status: "open" });
    expect(() => decideAssistanceChange(state, proposal.change_id, "apply", false, state.revision)).toThrow(/explicit user/);
    expect(workflowStates(state).get(referenceKey(proposal.before!))).toBe("active");
  });
  it("applies and reopens while preserving original documents and history", () => {
    const { state, proposal } = correction();
    const applied = decideAssistanceChange(state, proposal.change_id, "apply", true, state.revision);
    expect(workflowStates(applied).get(referenceKey(proposal.before!))).toBe("superseded");
    expect(applied.documents).toEqual(state.documents);
    const undone = decideAssistanceChange(applied, proposal.change_id, "reopen", true, applied.revision);
    expect(workflowStates(undone).get(referenceKey(proposal.before!))).toBe("active");
    expect(undone.events.length).toBe(state.events.length + 2);
  });
  it("preserves old and new field values directly from the actions", () => {
    const { state } = correction();
    expect(changeCards(state)[0]?.changed_fields).toContainEqual({ field: "temporal.date", before_value: "2026-10-05", after_value: "2026-10-12" });
  });
  it("rejects stale concurrent decisions and source-bound quote tampering", () => {
    const { state, proposal } = correction();
    expect(() => decideAssistanceChange(state, proposal.change_id, "apply", true, state.revision - 1)).toThrow(/refresh/);
    const changed = structuredClone(proposal); changed.change_id = "forged"; changed.quotes[0]!.text = "invented";
    expect(() => proposeAssistanceChange(state, changed, state.revision)).toThrow(/Quote/);
  });
  it("does not identify a target from identical or overlapping titles", () => {
    const state = withDocuments(notice("old", "2026-10-05"), notice("new", "2026-10-12"));
    expect(suggestDocumentChanges(state, "new")).toEqual([]);
  });
  it("keeps a missing target mapping as unresolved and unapplicable", () => {
    const { state, proposal } = correction(); const unknown = { ...proposal, change_id: "unknown", subject_key: "different" };
    const next = proposeAssistanceChange(state, unknown, state.revision);
    expect(changeCards(next).find(c => c.change_id === "unknown")?.target_resolution).toBe("unresolved");
    expect(() => decideAssistanceChange(next, "unknown", "apply", true, next.revision)).toThrow();
  });
  it("does not resolve ambiguous same-subject active versions", () => {
    const state = withDocuments(notice("a", "2026-10-05", { subject: "form" }), notice("b", "2026-10-06", { subject: "form" }), notice("c", "2026-10-12", { subject: "form" }));
    const proposal = suggestDocumentChanges(state, "c")[0]!; const next = proposeAssistanceChange(state, proposal, state.revision);
    expect(changeCards(next)[0]?.target_resolution).toBe("ambiguous");
    expect(() => decideAssistanceChange(next, proposal.change_id, "apply", true, next.revision)).toThrow();
  });
  it("does not link equal subject keys across schools", () => {
    const state = withDocuments(notice("a", "2026-10-05", { subject: "form", scope: "school-A" }), notice("b", "2026-10-12", { subject: "form", scope: "school-B" }));
    expect(suggestDocumentChanges(state, "b")).toHaveLength(0);
  });
  it("cancels only the explicitly confirmed target; never marks it complete", () => {
    const old = notice("old", "2026-10-15", { subject: "trip", action: { kind: "event" } });
    const text = "遠足は中止になりました。"; const hash = hashText(text);
    const cancel = { source_id: "cancel", source_hash: hash, scope_key: "school-A", canonical_text: text, manifest: { schema_version: "0.2.0", source: { id: "cancel", hash }, actions: [] }, actions: [] };
    let state = withDocuments(old, cancel);
    const proposal: ChangeProposal = { change_id: "cancel-trip", kind: "cancels", before: { source_id: old.source_id, source_hash: old.source_hash, action_id: "act_001" }, after: { source_id: "cancel", source_hash: hash }, scope_key: "school-A", subject_key: "trip", quotes: [{ source_id: "cancel", source_hash: hash, text }] };
    state = proposeAssistanceChange(state, proposal, state.revision);
    state = decideAssistanceChange(state, proposal.change_id, "apply", true, state.revision);
    expect(workflowStates(state).get(referenceKey(proposal.before!))).toBe("cancelled");
    expect(state.documents[0]?.actions[0]?.action.status).toBe("verified");
    expect(state.documents).toHaveLength(2);
  });
  it("will not replace with an independently blocked action", () => {
    const { state, proposal } = correction(); const blocked = structuredClone(state); blocked.documents[1]!.actions[0]!.trust = "blocked";
    expect(() => decideAssistanceChange(blocked, proposal.change_id, "apply", true, blocked.revision)).toThrow(/independently verified/);
  });
});
it("requires Undo of descendants before the preceding correction", () => {
  const initial = correction(); let state = decideAssistanceChange(initial.state, initial.proposal.change_id, "apply", true, initial.state.revision);
  state = registerSnapshot(state, notice("third", "2026-10-20", { subject: "permission-form" }), state.revision);
  const proposal = suggestDocumentChanges(state, "third")[0]!; state = proposeAssistanceChange(state, proposal, state.revision);
  state = decideAssistanceChange(state, proposal.change_id, "apply", true, state.revision);
  expect(() => decideAssistanceChange(state, initial.proposal.change_id, "reopen", true, state.revision)).toThrow(/dependent/);
  expect(changeCards(state).find(c => c.change_id === initial.proposal.change_id)?.changed_fields).toContainEqual({ field: "temporal.date", before_value: "2026-10-05", after_value: "2026-10-12" });
  state = decideAssistanceChange(state, proposal.change_id, "reopen", true, state.revision);
  state = decideAssistanceChange(state, initial.proposal.change_id, "reopen", true, state.revision);
  expect(workflowStates(state).get(referenceKey(initial.proposal.before!))).toBe("active");
});
it("retains new-source evidence when old evidence exceeds the wire quote budget", () => {
  const old = notice("old", "2026-10-05", { subject: "form" });
  old.actions[0]!.action.evidence = Array.from({ length: 33 }, () => ({ ...old.actions[0]!.action.evidence[0]! }));
  const state = withDocuments(old, notice("new", "2026-10-12", { subject: "form" }));
  const proposal = suggestDocumentChanges(state, "new")[0]!;
  expect(proposal.quotes.some(q => q.source_id === "new")).toBe(true);
  expect(proposal.quotes.some(q => q.source_id === "old")).toBe(true);
  expect(() => proposeAssistanceChange(state, proposal, state.revision)).not.toThrow();
  expect(state.documents[0]!.actions[0]!.action.evidence).toHaveLength(33);
});
