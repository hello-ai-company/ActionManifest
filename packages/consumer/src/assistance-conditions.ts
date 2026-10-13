import { ASSISTANCE_LIMITS, assertTimestamp, requireValue, stringValue } from "./assistance-common.js";
import type { Applicability, FactValue, LocalFact, Predicate, PredicateResult } from "./assistance-types.js";

function assertScalar(value: unknown): asserts value is FactValue {
  requireValue(typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= 256), "INVALID_FACT", "Facts must be finite numbers, booleans or bounded strings");
}
export function validatePredicate(rule: Predicate, depth = 0, budget = { count: 0 }): void {
  requireValue(rule && typeof rule === "object" && !Array.isArray(rule), "INVALID_RULE", "Predicate must be an object");
  requireValue(depth <= ASSISTANCE_LIMITS.depth && ++budget.count <= ASSISTANCE_LIMITS.rules, "INPUT_LIMIT", "Predicate exceeds complexity limit");
  const keys = rule.op === "eq" ? ["op", "fact", "value"] : rule.op === "in" ? ["op", "fact", "values"] : rule.op === "not" ? ["op", "rule"] : ["op", "rules"];
  requireValue(Object.keys(rule).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(rule, key)), "INVALID_RULE", "Unknown or missing predicate field");
  if (rule.op === "eq" || rule.op === "in") {
    stringValue(rule.fact, "fact key", 128);
    if (rule.op === "eq") assertScalar(rule.value);
    else {
      requireValue(Array.isArray(rule.values) && rule.values.length > 0 && rule.values.length <= 32, "INVALID_RULE", "Membership requires one to 32 values");
      rule.values.forEach(assertScalar);
    }
  } else if (rule.op === "not") validatePredicate(rule.rule, depth + 1, budget);
  else if (rule.op === "all" || rule.op === "any") {
    requireValue(Array.isArray(rule.rules) && rule.rules.length > 0, "INVALID_RULE", "Empty logical groups cannot establish applicability");
    rule.rules.forEach(child => validatePredicate(child, depth + 1, budget));
  } else requireValue(false, "INVALID_RULE", "Unknown predicate operator");
}
export function createPredicateEvaluator(facts: LocalFact[], now: string): (rule: Predicate) => PredicateResult {
  assertTimestamp(now);
  const nowMs = Date.parse(now);
  requireValue(Array.isArray(facts) && facts.length <= ASSISTANCE_LIMITS.facts, "INPUT_LIMIT", "Too many local facts");
  const byKey = new Map<string, LocalFact[]>();
  for (const fact of facts) {
    requireValue(fact && typeof fact === "object" && Object.keys(fact).every(key => ["key", "value", "expires_at"].includes(key)), "INVALID_FACT", "Unknown fact fields");
    stringValue(fact.key, "fact key", 128); assertScalar(fact.value);
    if (fact.expires_at !== undefined) assertTimestamp(fact.expires_at);
    byKey.set(fact.key, [...(byKey.get(fact.key) ?? []), fact]);
  }
  type FactLookup = { value?: FactValue; reason?: string; expires?: number };
  const cache = new Map<string, FactLookup>();
  const lookup = (key: string): FactLookup => {
    if (cache.has(key)) return cache.get(key)!;
    const all = byKey.get(key) ?? [];
    const current = all.filter(f => f.expires_at === undefined || Date.parse(f.expires_at) > nowMs);
    const distinct = [...new Map(current.map(f => [JSON.stringify(f.value), f.value])).values()];
    const expiries = current.flatMap(f => f.expires_at === undefined ? [] : [Date.parse(f.expires_at)]);
    const found = { ...(expiries.length ? { expires: Math.min(...expiries) } : {}), ...(distinct.length === 1 ? { value: distinct[0] } : { reason: distinct.length > 1 ? "FACT_CONFLICT" : all.length ? "FACT_EXPIRED" : "FACT_MISSING" }) };
    cache.set(key, found); return found;
  };
  return (rule: Predicate): PredicateResult => {
    validatePredicate(rule);
    let validUntil = Infinity;
    const missing = new Set<string>(); const conflicts = new Set<string>(); const reasons = new Set<string>();
    const run = (node: Predicate): Applicability => {
      if (node.op === "eq" || node.op === "in") {
        const fact = lookup(node.fact);
        if (fact.expires !== undefined) validUntil = Math.min(validUntil, fact.expires);
        if (fact.reason) {
          reasons.add(fact.reason); missing.add(node.fact);
          if (fact.reason === "FACT_CONFLICT") conflicts.add(node.fact);
          return "unknown";
        }
        return (node.op === "eq" ? fact.value === node.value : node.values.some(v => v === fact.value)) ? "applies" : "not_applicable";
      }
      if (node.op === "not") {
        const result = run(node.rule);
        return result === "unknown" ? result : result === "applies" ? "not_applicable" : "applies";
      }
      const values = node.rules.map(run);
      if (node.op === "all") return values.includes("not_applicable") ? "not_applicable" : values.includes("unknown") ? "unknown" : "applies";
      return values.includes("applies") ? "applies" : values.includes("unknown") ? "unknown" : "not_applicable";
    };
    const state = run(rule);
    // Unknown leaves that cannot change a decisive all/any result do not burden the user.
    return { state, ...(Number.isFinite(validUntil) ? { valid_until: new Date(validUntil).toISOString() } : {}), reason_codes: state === "unknown" ? [...reasons].sort() : [], missing_facts: state === "unknown" ? [...missing].sort() : [], conflicting_facts: state === "unknown" ? [...conflicts].sort() : [] };
  };
}

export function evaluatePredicate(rule: Predicate, facts: LocalFact[], now: string): PredicateResult {
  return createPredicateEvaluator(facts, now)(rule);
}
