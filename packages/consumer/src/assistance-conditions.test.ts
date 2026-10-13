import { describe, expect, it } from "vitest";
import { evaluatePredicate } from "./assistance-conditions.js";
import type { Predicate } from "./assistance-types.js";
import { NOW } from "../test/assistance-fixtures.js";

const participating: Predicate = { op: "eq", fact: "participates", value: true };
describe("local three-valued audience and condition evaluation", () => {
  it.each([[true, "applies"], [false, "not_applicable"]] as const)("preserves boolean %s", (value, state) => {
    expect(evaluatePredicate(participating, [{ key: "participates", value }], NOW).state).toBe(state);
  });
  it("never treats a missing fact as false, including through not", () => {
    expect(evaluatePredicate({ op: "not", rule: participating }, [], NOW)).toMatchObject({ state: "unknown", missing_facts: ["participates"] });
  });
  it("does not coerce boolean/number/string values", () => {
    expect(evaluatePredicate(participating, [{ key: "participates", value: "true" }], NOW).state).toBe("not_applicable");
  });
  it("uses current facts but never expired observations", () => {
    expect(evaluatePredicate(participating, [{ key: "participates", value: true, expires_at: NOW }], NOW)).toMatchObject({ state: "unknown", reason_codes: ["FACT_EXPIRED"] });
  });
  it("does not select one of conflicting facts by order", () => {
    const facts = [{ key: "participates", value: true }, { key: "participates", value: false }];
    expect(evaluatePredicate(participating, facts, NOW)).toMatchObject({ state: "unknown", conflicting_facts: ["participates"] });
    expect(evaluatePredicate(participating, [...facts].reverse(), NOW)).toEqual(evaluatePredicate(participating, facts, NOW));
  });
  it("accepts duplicate equal facts without inventing a conflict", () => {
    expect(evaluatePredicate(participating, [{ key: "participates", value: true }, { key: "participates", value: true }], NOW).state).toBe("applies");
  });
  it("uses three-valued logical rules without unnecessary questions", () => {
    const facts = [{ key: "grade", value: 3 }];
    expect(evaluatePredicate({ op: "all", rules: [participating, { op: "eq", fact: "grade", value: 1 }] }, facts, NOW)).toMatchObject({ state: "not_applicable", missing_facts: [] });
    expect(evaluatePredicate({ op: "any", rules: [participating, { op: "in", fact: "grade", values: [2, 3] }] }, facts, NOW)).toMatchObject({ state: "applies", missing_facts: [] });
  });
  it("rejects null, unknown operators, empty logical groups and unzoned timestamps", () => {
    expect(() => evaluatePredicate({ op: "eq", fact: "x", value: null } as unknown as Predicate, [], NOW)).toThrow();
    expect(() => evaluatePredicate({ op: "execute" } as unknown as Predicate, [], NOW)).toThrow();
    expect(() => evaluatePredicate({ op: "any", rules: [] }, [], NOW)).toThrow();
    expect(() => evaluatePredicate(participating, [], "2026-10-10")).toThrow();
  });
  it("bounds predicate complexity and cyclic input", () => {
    const rule = { op: "not" } as { op: "not"; rule: Predicate };
    rule.rule = rule;
    expect(() => evaluatePredicate(rule, [], NOW)).toThrow(/complexity/);
  });
});

it("bounds cached evaluation by earliest referenced current fact expiry", () => {
  const result = evaluatePredicate({ op: "all", rules: [{ op: "eq", fact: "a", value: true }, { op: "eq", fact: "b", value: true }] }, [
    { key: "a", value: true, expires_at: "2026-10-11T09:00:00+09:00" },
    { key: "b", value: true, expires_at: "2026-10-12T00:00:00Z" },
    { key: "irrelevant", value: true, expires_at: "2026-10-10T01:00:00Z" },
  ], "2026-10-10T00:00:00Z");
  expect(result).toMatchObject({ state: "applies", valid_until: "2026-10-11T00:00:00.000Z" });
});
it("does not extend expiry when conflicting facts can change the result", () => {
  expect(evaluatePredicate({ op: "eq", fact: "a", value: true }, [{ key: "a", value: true }, { key: "a", value: false, expires_at: "2026-10-11T00:00:00Z" }], "2026-10-10T00:00:00Z")).toMatchObject({ state: "unknown", valid_until: "2026-10-11T00:00:00.000Z" });
});
it("rejects impossible fact timestamps rather than normalizing them", () => {
  expect(() => evaluatePredicate({ op: "eq", fact: "a", value: true }, [{ key: "a", value: true, expires_at: "2026-02-30T00:00:00Z" }], "2026-10-10T00:00:00Z")).toThrow();
});
it("rejects unknown rule and misspelled expiry fields instead of assuming perpetual truth", () => {
  expect(() => evaluatePredicate({ op: "eq", fact: "a", value: true, unless: true } as never, [], "2026-10-10T00:00:00Z")).toThrow();
  expect(() => evaluatePredicate({ op: "eq", fact: "a", value: true }, [{ key: "a", value: true, expire_at: "2026-10-11T00:00:00Z" }] as never, "2026-10-10T00:00:00Z")).toThrow();
});
