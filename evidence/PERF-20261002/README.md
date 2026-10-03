# Performance / quality / Matoe evidence

Work started 2026-10-02 UTC and continued 2026-10-03 UTC. Baseline is local commit
`8ccb93c` on `fix/matoe-explicit-compatibility`, including both earlier unpushed
Matoe fixes. AGENTS.md was reread; no local `.agents/skills` exists. No agents,
remote writes, registry installation, external provider, credentials, or other
repository edits were used for this task.

## Measurement method

`scripts/performance.mjs` imports built public packages, never source aliases.
The baseline built packages/package manifests/frozen schemas were copied before
edits into `/tmp/am-perf-baseline-8ccb93c`; its workspace imports point to its own
packages, while third-party dependencies are the same existing locked versions.
This prevents accidentally measuring the new Core through an old verifier.

Final probes use Node 24.19.0 on Linux, AMD EPYC 9V74, fresh process per case/stage,
5 warmups and 21 samples. `--expose-gc` collects before each timed operation;
GC, module load, input generation and child-process startup are outside elapsed
latency. Timings include all work performed inside each stage. Samples are sorted:
median is sample 11 and p95 is sample 20. These are local in-memory warmed timings,
not service-level percentiles, network latency, Swift/iOS, or statistical confidence intervals.

Inputs are synthetic, fixed strings: 1, 32, 128 actions and a 64-action long document
with about 45,000 additional narrative characters. All stay within Matoe limits.
The pipeline is PlainTextAdapter → actual deterministic ActionExtractor → verifier.
The Matoe stage starts from a verified, complete manifest. Source sizes and SHA-256
input/output fingerprints are included per row. Timestamps alone are replaced
before output hashing. **All 12 before/after output fingerprints match**, as do
all input fingerprints. Deliberate English quality changes use a separate corpus.

Re-run current build with `node scripts/performance.mjs --samples 21`.
For before/after reproduction, use a separate local checkout of `8ccb93c`, build
with the same pinned toolchain and existing locked dependencies, and pass its
absolute path with `--root`. If an offline dependency cache is unavailable,
stop rather than make a network installation. No LLM key is needed.

Final results are in performance-before-final.json / performance-after-final.json.
performance-before.json and performance-after-optimization.json are preliminary
11-sample measurements; they are retained as the initial baseline and intermediate
finding, not used as the final effect estimate. Final probes were run serially.

## Improvements and boundaries

- Verifier now normalizes source quotes and builds page membership once per
  invocation. Source year context/dates are parsed lazily at most once, while
  each Action's own evidence, temporal, actor, modality, negation and page checks
  are still run. `verifyAction` keeps its public signature and standalone behavior.
- The extractor skips heading lookup only if no canonical chunk has a section.
  A heading cannot be recognized in that situation. Structured documents still
  run the same lookup; real Evidence locators are still created.
- All reusable state is request-local. There is no global/user/doc-ID/hash cache
  of verification outcomes. Regression tests change text, hash, pages and version
  for the same ID and check fresh decisions. Structural performance regressions
  assert parser/locator work counts, rather than flaky machine-time thresholds.
- English field-trip/checkup planning clauses now recognize event subjects and
  correct-date titles. Recognition is anchored and excludes negated/hypothetical
  clauses; past scheduling requires a correction. Existing cancellation and
  uncertainty guards remain. Exact days are not invented from “around November.”
- Matoe accepts only completely identical duplicate Evidence, without dropping
  copies or locators. Distinct evidence and the other unsupported safety fields
  remain rejected. Coverage/reasons and design fixtures are linked below.

## Quality and compatibility

quality-before.json / quality-after.json contain the full existing 74-fixture
corpus report (47 JP, 27 EN, 40 adversarial). Rates are fixture-macro averages,
not population-wide accuracy. Only three scores changed: adv-en-approximate,
adv-en-correction and adv-en-reverse-correction; each changes kind matching from
R/P 0 to R/P 1. Other 71 fixture score objects are identical. The optimization-only
intermediate run matched the entire original report before adding English cues.

| Metric | Before | After |
| --- | --- | --- |
| Action recall | 87.84% | 91.89% |
| Action precision | 72.07% | 76.13% |
| Deadline accuracy | 86.49% | 89.19% |
| Ambiguity preservation | 97.30% | 98.65% |
| Evidence match | 100% | 100% |
| Critical false verified | 0 | 0 |
| Golden / adversarial golden | PASS / PASS | PASS / PASS |

Hallucination rate remains 3.38%, actor accuracy 96.85%, modality accuracy 80.41%,
and Action verification rate 96.04%. No validation pass-rate improvement is claimed.

`scripts/matoe-coverage.mjs` runs actual deterministic extraction/verification over
the same corpus. compatibility-before.json / compatibility-after.json report
**39 accepted / 35 refused**, unchanged. First refusal counts are 13 conditions/notes,
9 temporal forms, 6 verification issues, 5 distinct Evidence and 2 actor identity;
rows include co-occurring feature flags, so these counts are not prevalence of every
unsupported field. No timezone example exists in this corpus; it is separately
covered by contract tests and a handoff fixture.

The separate identical-Evidence probe changes refusal to acceptance while preserving
both copies in original/wire/audit. This does not make general multiple-evidence
or guardian input supported. The English correction cases now carry event instead
of other kind, so the actual Swift source's type/date mapping can represent them;
that is static contract evidence, not executed Swift proof.

See [Matoe design handoff](../../docs/MATOE-DESIGN-HANDOFF.md) for common unsupported
inputs, native 0.1 fixtures and concrete client changes. Swift, UI, local HTTP,
backend configuration/audit retention and real-device timezone/DST remain unverified.

## Final latency and memory

| Case / stage | Median before → after (ms) | p95 before → after (ms) | Median ratio before/after |
| --- | --- | --- | --- |
| short / verify | 0.119 → 0.131 | 0.297 → 0.279 | 0.9× |
| short / matoe | 0.156 → 0.183 | 0.320 → 0.460 | 0.9× |
| short / pipeline | 0.259 → 0.266 | 0.711 → 0.741 | 1.0× |
| notice / verify | 2.622 → 0.452 | 3.248 → 0.686 | 5.8× |
| notice / matoe | 0.751 → 0.928 | 1.029 → 1.153 | 0.8× |
| notice / pipeline | 3.392 → 1.229 | 3.645 → 1.744 | 2.8× |
| many / verify | 30.957 → 1.568 | 33.316 → 2.118 | 19.7× |
| many / matoe | 3.801 → 1.816 | 5.461 → 2.268 | 2.1× |
| many / pipeline | 37.896 → 5.128 | 39.197 → 5.981 | 7.4× |
| long / verify | 40.998 → 1.120 | 47.132 → 1.718 | 36.6× |
| long / matoe | 11.517 → 1.755 | 15.316 → 2.404 | 6.6× |
| long / pipeline | 1267.918 → 46.183 | 1329.488 → 52.117 | 27.5× |

Short single-action timings do not improve. The 32-action Matoe stage is slower in
this final run (0.751 → 0.928 ms); small sub-millisecond differences and run noise
should not be presented as broad gains. Long-document and many-action results
improve substantially. No claim is made that every input or every stage is faster.

Absolute post-GC heap is approximately 0.08–0.19 MiB greater after the change,
including loaded code; this probe does not demonstrate a universal memory reduction.
Process peak RSS for long pipeline is 108.43 → 88.40 MiB; other cases are mixed.
Raw JSON includes absolute heap, heap delta and process peak RSS per fresh worker.
RSS covers worker setup/module loads as well as the operation; these are not
isolated allocation counts, nor evidence of long-running service memory behavior.

## Final verification and review

Node 24.19.0 / pnpm 11.23.0, offline cached dependencies. All command exit codes
are 0; see checks.json. Normal code + schema/API + integration checks follow AGENTS.md.

- build, lint, typecheck, schema:validate, docs:check: PASS
- test: 609/609, 52 files
- integration:test: 25/25, 6 files (built packages and CLI included)
- conformance: 65/65; critical false exported 0
- conformance:reference: 4/4
- xberg:integration: 2/2, mocked server; no external OCR call

Self-review: frozen schemas and default 0.2 output are unchanged; public standalone
verification behavior is preserved. Request-local reuse never bypasses schema,
hash, provenance, per-action evidence/date/page/negation, issue or approval gates.
Distinct Evidence still rejects; identical duplicates retain every copy. New English
recognition is anchored to two explicit event subjects and has negative cases for
hypothetical, historical, negated and cancelled inputs. Six design fixtures test
refusal and schema/hash validity without pretending to be service-verified inputs.

No external calls or remote writes were performed for this performance task.
No Swift runtime, Matoe UI, configured analysis backend, HTTP connection, production
deployment, real payment or message send was exercised. This is local code and
contract evidence, not an end-to-end Matoe success claim.
