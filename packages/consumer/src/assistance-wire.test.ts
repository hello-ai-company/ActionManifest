import { it, expect } from "vitest";
import { validateAssistanceCompanion, acceptAssistanceSnapshot } from "./assistance-wire.js";
import { refreshAssistance } from "./assistance-project.js";
import { notice, withDocuments, localProfile, NOW } from "../test/assistance-fixtures.js";
const sample = () => { const state = withDocuments(notice("a", "2026-10-15")); return refreshAssistance(state, [localProfile], [], NOW, state.revision).companion; };
it("rejects unknown protocols and enum values", () => {
  const value = sample(); expect(() => validateAssistanceCompanion({ ...value, protocol_version: "0.2.0" })).toThrow();
  expect(() => validateAssistanceCompanion({ ...value, evaluations: [{ ...value.evaluations[0], state: "probably" }] })).toThrow();
});
it("rejects nulls and unknown fields rather than silently discarding them", () => {
  expect(() => validateAssistanceCompanion({ ...sample(), ledger_id: null })).toThrow();
  expect(() => validateAssistanceCompanion({ ...sample(), notification_permission: true })).toThrow();
});
it("rejects non-JSON values, cycles and unreasonable nesting", () => {
  const value: Record<string, unknown> = { ...sample() }; value.extra = value; expect(() => validateAssistanceCompanion(value)).toThrow();
  expect(() => validateAssistanceCompanion({ ...sample(), extra: () => true })).toThrow();
});
it("permits aliased references when serialized JSON is valid", () => {
  const value = sample(); value.evaluations.push({ ...value.evaluations[0]!, profile_id: "another" });
  expect(validateAssistanceCompanion(value)).toEqual(value);
});
it("rejects contradictory readiness and approximate calendar eligibility", () => {
  const value = sample(); value.evaluations[0]!.trust = "blocked"; expect(() => validateAssistanceCompanion(value)).toThrow();
  value.evaluations[0]!.trust = "ready"; value.evaluations[0]!.calendar_eligible = true; value.evaluations[0]!.date_state = "approximate";
  expect(() => validateAssistanceCompanion(value)).toThrow();
});
it("rejects impossible and offset-free validity timestamps", () => {
  const value = sample(); value.evaluations[0]!.valid_until = "2026-02-30T00:00:00Z"; expect(() => validateAssistanceCompanion(value)).toThrow();
  value.evaluations[0]!.valid_until = "2026-10-11T00:00:00"; expect(() => validateAssistanceCompanion(value)).toThrow();
});
it("does not replace a ledger with an older snapshot or another stream", () => {
  const value = sample(); expect(() => acceptAssistanceSnapshot(value, { ...value, revision: value.revision - 1 })).toThrow(/older/);
  expect(() => acceptAssistanceSnapshot(value, { ...value, ledger_id: "other" })).toThrow(/ledger/);
});
it("rejects same-revision payload collision while accepting exact repeats", () => {
  const value = sample(); expect(acceptAssistanceSnapshot(value, JSON.parse(JSON.stringify(value)))).toEqual(value);
  expect(() => acceptAssistanceSnapshot(value, { ...value, evaluations: [] })).toThrow(/different content/);
});
it("rejects duplicate action/profile projections", () => {
  const value = sample(); value.evaluations.push(value.evaluations[0]!); expect(() => validateAssistanceCompanion(value)).toThrow();
});
it("rejects contradictory ready targets and incomplete resolved correction identity", async () => {
  const { readFileSync } = await import("node:fs");
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../docs/assistance/fixtures/companion-${name}.json`, import.meta.url), "utf8"));
  const resolved = fixture("resolved"); Object.assign(resolved.evaluations[0], { workflow_state: "active", ready_for_use: true, calendar_eligible: true });
  expect(() => validateAssistanceCompanion(resolved)).toThrow();
  const open = fixture("open"); Object.assign(open.evaluations[0], { state: "applies", ready_for_use: true, calendar_eligible: true });
  expect(() => validateAssistanceCompanion(open)).toThrow();
  const missing = fixture("resolved"); delete missing.changes[0].after.action_id;
  expect(() => validateAssistanceCompanion(missing)).toThrow();
});
