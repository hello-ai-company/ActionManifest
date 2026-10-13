import { describe, expect, it } from "vitest";
import { projectAssistance, refreshAssistance, decideAssistanceReview } from "./assistance-project.js";
import { proposeAssistanceChange, decideAssistanceChange, suggestDocumentChanges } from "./assistance-ledger.js";
import { validateAssistanceCompanion, acceptAssistanceSnapshot } from "./assistance-wire.js";
import { notice, withDocuments, localProfile, NOW } from "../test/assistance-fixtures.js";
import { quotesFor } from "./assistance-common.js";
import type { ActionRuleSet } from "./assistance-types.js";

function conditional() {
  const doc = notice("conditional", "2026-10-15", { text: "参加者のみ水筒を持参してください。", action: { kind: "prepare", conditions: ["参加者のみ"], temporal: undefined } });
  const action_ref = { source_id: doc.source_id, source_hash: doc.source_hash, action_id: "act_001" };
  const rule: ActionRuleSet = { action_ref, confirmation: "user_confirmed", condition: { op: "eq", fact: "participates", value: true }, covers_conditions: ["参加者のみ"], quotes: quotesFor(doc, "act_001") };
  return { doc, rule, state: withDocuments(doc) };
}

describe("evidence-backed review queues and audience projection", () => {
  it("marks an unparsed source condition unknown and preserves its quote", () => {
    const { state } = conditional(); const result = projectAssistance(state, [localProfile], [], NOW);
    expect(result.evaluations[0]).toMatchObject({ state: "unknown", ready_for_use: false, reason_codes: ["CONDITION_UNMAPPED"] });
    expect(result.review_queue[0]?.quotes[0]?.text).toContain("参加者のみ");
  });
  it("does not use a proposed rule as a confirmed fact interpretation", () => {
    const { state, rule } = conditional(); rule.confirmation = "proposed";
    const result = projectAssistance(state, [{ ...localProfile, facts: [{ key: "participates", value: true }] }], [rule], NOW);
    expect(result.evaluations[0]?.state).toBe("unknown");
  });
  it("asks only for the missing fact, with a profile identity", () => {
    const { state, rule } = conditional(); const result = projectAssistance(state, [localProfile], [rule], NOW);
    expect(result.review_queue).toHaveLength(1);
    expect(result.review_queue[0]).toMatchObject({ field: "applicability", profile_id: "local-child-A", reason_codes: ["FACT_MISSING"] });
    expect(result.evaluations[0]?.missing_facts).toEqual(["participates"]);
  });
  it("applies only to the matching school/profile and factual condition", () => {
    const { state, rule } = conditional(); const result = projectAssistance(state, [
      { ...localProfile, facts: [{ key: "participates", value: true }] },
      { profile_id: "child-B", scope_key: "school-B", facts: [{ key: "participates", value: true }] },
      { profile_id: "child-C", scope_key: "school-A", facts: [{ key: "participates", value: false }] },
    ], [rule], NOW);
    expect(result.evaluations.map(e => [e.state, e.ready_for_use])).toEqual([["applies", true], ["not_applicable", false], ["not_applicable", false]]);
  });
  it("does not treat a missing school or explicit unstructured audience as universal", () => {
    const state = withDocuments(notice("audience", "2026-10-15", { action: { actor: { certainty: "explicit", text: "参加者", role: "participant" } } }));
    expect(projectAssistance(state, [localProfile], [], NOW).evaluations[0]?.state).toBe("unknown");
    expect(projectAssistance(state, [{ profile_id: "no-scope", facts: [] }], [], NOW).evaluations[0]?.state).toBe("unknown");
  });
  it("acknowledging/dismissing a review never makes unknown evidence ready", () => {
    const { state, rule } = conditional(); const before = projectAssistance(state, [localProfile], [rule], NOW);
    const next = decideAssistanceReview(state, before.review_queue[0]!, "resolved", state.revision);
    const after = projectAssistance(next, [localProfile], [rule], NOW);
    expect(after.review_queue[0]?.status).toBe("resolved"); expect(after.evaluations[0]?.ready_for_use).toBe(false);
  });
  it("changed facts create a new fingerprint instead of inheriting stale acknowledgement", () => {
    const { state, rule } = conditional(); const before = projectAssistance(state, [localProfile], [rule], NOW);
    const next = decideAssistanceReview(state, before.review_queue[0]!, "dismissed", state.revision);
    const after = projectAssistance(next, [{ ...localProfile, facts: [{ key: "participates", value: true, expires_at: "2026-10-09T00:00:00Z" }] }], [rule], NOW);
    expect(after.review_queue[0]?.status).toBe("open"); expect(after.review_queue[0]?.fingerprint).not.toBe(before.review_queue[0]?.fingerprint);
  });
  it("a blocked action cannot become ready from favorable local facts", () => {
    const doc = notice("blocked", "2026-10-15", { trust: "blocked" });
    const result = projectAssistance(withDocuments(doc), [localProfile], [], NOW);
    expect(result.evaluations[0]).toMatchObject({ trust: "blocked", ready_for_use: false });
    expect(result.review_queue.some(i => i.field === "verification")).toBe(true);
  });
  it("holds both sides of a proposed correction until explicit confirmation", () => {
    const old = notice("old", "2026-10-05", { subject: "form" }); const newer = notice("new", "2026-10-12", { subject: "form" });
    let state = withDocuments(old, newer); const proposal = suggestDocumentChanges(state, "new")[0]!; state = proposeAssistanceChange(state, proposal, state.revision);
    expect(projectAssistance(state, [localProfile], [], NOW).evaluations.every(e => !e.ready_for_use)).toBe(true);
    state = decideAssistanceChange(state, proposal.change_id, "apply", true, state.revision);
    expect(projectAssistance(state, [localProfile], [], NOW).evaluations.map(e => [e.workflow_state, e.ready_for_use])).toEqual([["superseded", false], ["active", true]]);
  });
  it.each(["approximate", "relative", "unknown", "conditional"] as const)("never promotes %s dates into firm calendar candidates", type => {
    const state = withDocuments(notice("event", "2026-10-15", { action: { kind: "event", temporal: { type, raw_text: "10月頃" } } }));
    const result = projectAssistance(state, [localProfile], [], NOW);
    expect(result.evaluations[0]?.calendar_eligible).toBe(false); expect(result.review_queue.some(i => i.field === "temporal.date")).toBe(true);
  });
  it("distinguishes exact date-only planning from timed conflict authority", () => {
    const state = withDocuments(notice("event", "2026-10-15", { action: { kind: "event" } }));
    expect(projectAssistance(state, [localProfile], [], NOW).evaluations[0]).toMatchObject({ date_state: "exact", calendar_eligible: true });
    // No isAllDay=false, invented time/end or timed-conflict field is emitted.
    expect(JSON.stringify(projectAssistance(state, [localProfile], [], NOW))).not.toContain("isAllDay");
  });
  it("a fact update advances sync revision; identical output is idempotent", () => {
    const { state, rule } = conditional(); const first = refreshAssistance(state, [localProfile], [rule], NOW, state.revision);
    const same = refreshAssistance(first.state, [localProfile], [rule], NOW, first.state.revision);
    expect(same.state.revision).toBe(first.state.revision);
    const changed = refreshAssistance(same.state, [{ ...localProfile, facts: [{ key: "participates", value: true }] }], [rule], NOW, same.state.revision);
    expect(changed.companion.revision).toBeGreaterThan(first.companion.revision);
    expect(acceptAssistanceSnapshot(first.companion, changed.companion)).toEqual(changed.companion);
  });
  it("produces strict wire JSON with omitted optional fields", () => {
    const { state, rule } = conditional(); const result = refreshAssistance(state, [localProfile], [rule], NOW, state.revision);
    expect(validateAssistanceCompanion(JSON.parse(JSON.stringify(result.companion)))).toEqual(result.companion);
  });
});

it("expires readiness at the boundary and advances snapshot revision", () => {
  const { state, rule } = conditional();
  const profiles = [{ ...localProfile, facts: [{ key: "participates", value: true, expires_at: "2026-10-11T00:00:00Z" }] }];
  const first = refreshAssistance(state, profiles, [rule], NOW, state.revision);
  expect(first.companion.evaluations[0]).toMatchObject({ ready_for_use: true, valid_until: "2026-10-11T00:00:00.000Z" });
  expect(validateAssistanceCompanion(first.companion)).toEqual(first.companion);
  const after = refreshAssistance(first.state, profiles, [rule], "2026-10-11T00:00:00Z", first.state.revision);
  expect(after.companion.evaluations[0]).toMatchObject({ ready_for_use: false, reason_codes: ["FACT_EXPIRED"] });
  expect(after.companion.revision).toBeGreaterThan(first.companion.revision);
});
it("rejects rule grounding from a different action or arbitrary same-document sentence", () => {
  const { state, rule } = conditional();
  rule.quotes[0]!.action_id = "different-action";
  expect(() => projectAssistance(state, [localProfile], [rule], NOW)).toThrow();
  delete rule.quotes[0]!.action_id;
  expect(() => projectAssistance(state, [localProfile], [rule], NOW)).toThrow();
});
it("holds every ambiguous target candidate, not just the new source", () => {
  let state = withDocuments(notice("a", "2026-10-05", { subject: "form" }), notice("b", "2026-10-06", { subject: "form" }), notice("c", "2026-10-12", { subject: "form" }));
  const proposal = suggestDocumentChanges(state, "c")[0]!;
  state = proposeAssistanceChange(state, proposal, state.revision);
  expect(projectAssistance(state, [localProfile], [], NOW).evaluations.every(e => !e.ready_for_use && e.reason_codes.includes("CONFIRM_REVISION_LINK"))).toBe(true);
});
it("does not reopen an acknowledged missing-fact question for unrelated fact edits", () => {
  const { state, rule } = conditional(); const first = projectAssistance(state, [localProfile], [rule], NOW);
  const next = decideAssistanceReview(state, first.review_queue[0]!, "dismissed", state.revision);
  const after = projectAssistance(next, [{ ...localProfile, facts: [{ key: "unrelated", value: true }] }], [rule], NOW);
  expect(after.review_queue[0]).toMatchObject({ fingerprint: first.review_queue[0]!.fingerprint, status: "dismissed" });
});
it("keeps inconsistent date and datetime fields out of firm calendar use", () => {
  const state = withDocuments(notice("event", "2026-10-15", { action: { kind: "event", temporal: { type: "exact", date: "2026-10-15", datetime: "2026-10-16T09:00:00+09:00", raw_text: "ambiguous" } } }));
  expect(projectAssistance(state, [localProfile], [], NOW).evaluations[0]).toMatchObject({ date_state: "unknown", calendar_eligible: false });
});
it("derives held ambiguous candidates even when caller omits candidate hints", () => {
  let state = withDocuments(notice("a", "2026-10-05", { subject: "form" }), notice("b", "2026-10-06", { subject: "form" }), notice("c", "2026-10-12", { subject: "form" }));
  const proposal = suggestDocumentChanges(state, "c")[0]!;
  proposal.before = proposal.target_candidates![0]!; delete proposal.target_candidates;
  state = proposeAssistanceChange(state, proposal, state.revision);
  const result = projectAssistance(state, [localProfile], [], NOW);
  expect(result.changes[0]!.target_resolution).toBe("ambiguous");
  expect(result.evaluations.every(e => !e.ready_for_use)).toBe(true);
});
it("bounds displayed quotes while retaining all original evidence", () => {
  const doc = notice("many-quotes", "2026-10-15", { trust: "review_required" });
  doc.actions[0]!.action.evidence = Array.from({ length: 33 }, () => ({ ...doc.actions[0]!.action.evidence[0]! }));
  const state = withDocuments(doc); const result = refreshAssistance(state, [localProfile], [], NOW, state.revision);
  expect(result.companion.review_queue[0]!.quotes).toHaveLength(32);
  expect(result.state.documents[0]!.actions[0]!.action.evidence).toHaveLength(33);
});
it("cannot borrow another action's locator for an identical quote", () => {
  const { doc, rule } = conditional();
  doc.actions[0]!.action.evidence[0]!.page = 1;
  const other = structuredClone(doc.actions[0]!); other.action.id = "act_other"; other.action.evidence[0]!.page = 2;
  doc.actions.push(other); doc.manifest.actions.push(other.action);
  const state = withDocuments(doc);
  rule.quotes = quotesFor(doc, "act_001"); rule.quotes[0]!.page = 2;
  expect(() => projectAssistance(state, [localProfile], [rule], NOW)).toThrow(/Locator/);
});
