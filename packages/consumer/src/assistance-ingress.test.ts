/** Full frozen-schema ingress/replay tests. Requires actual AJV; never substitute a stub. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { registerAssistanceDocument } from "./assistance-ingress.js";
import { restoreAssistanceState } from "./assistance-persistence.js";
import { createAssistanceState } from "./assistance-ledger.js";
import { refreshAssistance, decideAssistanceReview } from "./assistance-project.js";
const read = (name: string) => readFileSync(new URL(`../fixtures/matoe-v02/${name}`, import.meta.url), "utf8");
const sourceId = "11111111-1111-4111-8111-111111111111";
const register = (name = "golden.json") => registerAssistanceDocument(createAssistanceState("fixture-ledger"), JSON.parse(read(name)), read("source.txt"), sourceId, "school-A", [], 0);
it("registers through frozen v0.2 ingress and roundtrips replayed local state", () => {
  const state = register(); expect(restoreAssistanceState(JSON.stringify(state))).toEqual(state);
});
it("preserves mixed failures and never restores tampered stored trust", () => {
  const state = register("mixed.json"); expect(state.documents[0]!.actions.some(a => a.trust === "blocked")).toBe(true);
  const index = state.documents[0]!.actions.findIndex(a => a.trust === "blocked"); state.documents[0]!.actions[index]!.trust = "ready";
  expect(() => restoreAssistanceState(JSON.stringify(state))).toThrow();
});
it("does not restore fabricated canonical text, action contents or history", () => {
  const state = register(); state.documents[0]!.canonical_text += " fabricated";
  expect(() => restoreAssistanceState(JSON.stringify(state))).toThrow();
  const action = register(); action.documents[0]!.actions[0]!.action.title = "fabricated";
  expect(() => restoreAssistanceState(JSON.stringify(action))).toThrow();
  const history = register(); history.events.push({ type: "change_decided", change_id: "missing", decision: "apply", confirmed_by_user: true }); history.revision++;
  expect(() => restoreAssistanceState(JSON.stringify(history))).toThrow();
});
it("retains queue acknowledgement on replay without elevating action readiness", () => {
  const registered = register(); const first = refreshAssistance(registered, [{ profile_id: "local", facts: [] }], [], "2026-10-10T00:00:00Z", registered.revision);
  const state = decideAssistanceReview(first.state, first.companion.review_queue[0]!, "resolved", first.state.revision);
  const restored = restoreAssistanceState(JSON.stringify(state)); expect(restored).toEqual(state);
  expect(refreshAssistance(restored, [{ profile_id: "local", facts: [] }], [], "2026-10-10T00:00:00Z", restored.revision).companion.evaluations.every(e => !e.ready_for_use)).toBe(true);
});
it("rejects empty/fatal/unknown-version ingress and oversized persisted JSON", () => {
  expect(() => registerAssistanceDocument(createAssistanceState("fixture-ledger"), {}, "text", sourceId, "school-A", [], 0)).toThrow();
  expect(() => restoreAssistanceState(" ".repeat(8 * 1024 * 1024 + 1))).toThrow();
});
