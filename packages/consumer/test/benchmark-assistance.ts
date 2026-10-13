/** Narrow reproducible synthetic microbenchmark; no competitor or production claim. */
import { performance } from "node:perf_hooks";
import { evaluatePredicate, createPredicateEvaluator } from "../src/assistance-conditions.js";
import type { LocalFact, Predicate } from "../src/assistance-types.js";
const facts: LocalFact[] = Array.from({ length: 128 }, (_, i) => ({ key: `f${i}`, value: i % 2 === 0, expires_at: "2026-10-20T00:00:00Z" }));
const rules: Predicate[] = Array.from({ length: 1000 }, (_, i) => ({ op: "eq", fact: `f${i % facts.length}`, value: true }));
const now = "2026-10-10T00:00:00Z";
const uncached = () => rules.map(rule => evaluatePredicate(rule, facts, now));
const cached = () => { const evaluate = createPredicateEvaluator(facts, now); return rules.map(evaluate); };
const a = uncached(), b = cached(); if (JSON.stringify(a) !== JSON.stringify(b)) throw Error("Optimization changed output");
function median(run: () => unknown) { const times: number[] = []; for (let i = 0; i < 5; i++) { const t = performance.now(); run(); times.push(performance.now() - t); } return times.sort((a,b) => a-b)[2]!; }
console.log(JSON.stringify({ synthetic: true, node: process.version, rules: rules.length, facts: facts.length, repetitions: 5, index_builds_uncached: rules.length, index_builds_cached: 1, results_identical: true, uncached_median_ms: median(uncached), cached_median_ms: median(cached), scope: "Predicate evaluator only; does not measure OCR/extraction/AJV/Swift/end-to-end performance." }, null, 2));
