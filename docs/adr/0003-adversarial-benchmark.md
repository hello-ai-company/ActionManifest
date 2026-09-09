# ADR 0003 — Phase 1.2: Adversarial Document Reliability Benchmark

Status: Accepted
Date: 2026-09-09

## Context

Phase 1.1 made verification per-Action. But the benchmark corpus was drawn from
well-formed notices and its `expected.json` files largely mirrored the
deterministic extractor's output. That cannot catch the failure mode that matters
most for a trust layer: a **plausible but wrong Action marked `verified`**
(a stale/superseded date, a cancelled event, a quoted old instruction, a negated
requirement resurrected as required).

## Decision

Add an **evaluation-only** Adversarial Document Reliability Benchmark. No new Core
principle; no production schema change.

1. **Expected truth is the oracle, not the extractor.** Each adversarial
   `expected.json` is human-authored *before* comparison and MUST NOT be rewritten
   to match extractor output. Documented as an integrity guard in
   `docs/ADVERSARIAL-BENCHMARK.md` and `CONTRIBUTING.md`.
2. **Negative expectations.** A benchmark-only `must_not_extract` contract lists
   Actions that must not be produced (or, if produced, must not be verified). This
   lives only in fixtures — never in the production Action Manifest schema.
3. **Failure taxonomy + severity** (benchmark-internal): critical / high / medium.
4. **False Verified Action Rate** is the primary safety metric; **critical
   false-verified must be 0**, enforced in CI (`pnpm benchmark` + smoke).
5. **Adversarial Golden Set** (10 fixtures) runs in CI smoke with the original
   Golden Fixture.

## Minimal fixes discovered by the corpus

Following the test-first rule (fixture → fail → minimal fix → pass), the corpus
surfaced concrete false-verified bugs, fixed minimally without expanding scope:

- **Correction / extension** — `primaryTemporal` now picks the corrected (later)
  date, so a superseded date is never the active one.
- **Cancellation / reference / quotation / completed-past** — the deterministic
  extractor skips these sentences instead of emitting an active Action.
- **Blanket contradiction** — the verifier treats a required submit negated for
  everyone ("提出は不要" / "no longer required") as a conflict, while genuine
  eligibility / prior-submission exemptions still verify.

No large refactor, no LLM, no new provider.

### Pre-merge hardening (PR #3 review)

Real code review found three position-heuristic false-verified risks the initial
60-fixture corpus did not exercise. Fixed minimally, with fixtures that fail
before and pass after (8 critical false-verified → 0):

- **Correction target ≠ chronological max.** `primaryTemporal` selects the dated
  temporal nearest the correction cue (the replacement target), correct for
  reverse corrections; unresolvable → omit.
- **Cross-sentence cancellation.** A cancellation sentence deactivates the
  matching earlier Action (by subject/object) without touching unrelated Actions.
- **Negation targets its subject, not the last Action.** A blanket negation binds
  to the Action it names; unresolvable → prohibited/omit, never contaminating an
  unrelated Action. `isExemption` narrowed so a blanket "提出は不要" is not misread
  as an eligibility exemption.

Benchmark-only failure codes `WRONG_NEGATION_TARGET` / `WRONG_CANCELLATION_TARGET`
were added (never in the production schema).

A second review round found two more position/identity risks, fixed the same way
(fixtures fail before, pass after; 6 → 0 critical):

- **Correction cue coverage & from→to / gerund targets.** The resolver drops the
  date explicitly marked as superseded and keeps the replacement, so `XからYに変更`,
  `changed from X to Y`, and `…変更し、Yに実施します` resolve to Y — not the first
  date and not the chronological max. The `mdRe` prefix guard was narrowed so a
  separate date after `から` is not suppressed by an era mention earlier in the
  sentence.
- **English target identity.** A small canonical-target resolver (lowercase,
  strip punctuation / leading imperative verbs / determiners) lets a negation bind
  its named submit across `Please submit the permission form` / `The permission
  form` / `permission form`, without contaminating unrelated Actions. No NLP
  dependency; unresolved targets are never attached.

## Consequences

- Downstream consumers get a measured guarantee that critical wrong Actions are
  not verified. Recall may be intentionally lower on adversarial inputs — the
  trust order prefers omission over a confident-wrong Action.
- Contributors cannot silently pass CI by rewriting expected truth; the integrity
  guard and review guidance make that a rejected change.
