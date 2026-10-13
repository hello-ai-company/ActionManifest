# Japanese notice trust hardening: verification report

## Scope and status

Baseline: `a56242333511ef2d392d2681273c54ac89bfa7bc` (source-only public main).
This is an unpublished candidate patch, not a release-readiness claim. It changes
only deterministic extraction, temporal/modality handling, per-action verification,
synthetic tests and documentation. No schema/version/dependency change, external
service, notification delivery, real child data or paid model API is involved.

## What changed

1. Any populated calendar date must be supported by the Action's own quotes. Document year
   context remains available, but unrelated dates cannot satisfy verification.
2. Old dates in correction notices no longer satisfy verification as active
   dates. Multiple unresolved replacement dates, or an old date without a
   replacement, remain undated instead of selecting by proximity.
3. A uniquely named later correction replaces the earlier candidate without
   silently dropping its eligibility, actor or optional modality evidence.
4. Bare event subjects such as 遠足 can be cancelled independently of another
   event in the notice. An active event quoting cancellation fails verification.
5. Required preparations, payments and other action kinds fail on blanket
   negation. Inventing an exemption label does not negate a source withdrawal.
6. Japanese 場合/とき predicates survive in conditional preparation. A correct
   quote alone is insufficient when the condition is absent or reversed.
7. Standalone items such as 水筒/タオル/帽子 can be targeted. 用意 remains preparation;
   the extractor does not rewrite it as 持参.

Schema `0.1.0` and `0.2.0` hashes and production validation are untouched.
The new issue codes use the existing string-code contract and per-action flags.

## Fixtures and integrity

Ten new synthetic Japanese notices were authored, with expected active actions
and critical negative expectations saved and hashed before implementation:

- `adv-jp-bare-subject-cancellation`
- `adv-jp-cross-sentence-correction`
- `adv-jp-prepare-negation`
- `adv-jp-unresolved-correction`
- `adv-jp-weather-conditional-prepare`
- `adv-jp-participation-conditional-prepare`
- `adv-jp-distinct-form-correction`
- `adv-jp-deadline-kind-correction`
- `adv-jp-chained-date-corrections`
- `adv-jp-ambiguous-correction-target`

The last four were added following independent review, with semantic truth
hashed before the corresponding repairs. The review exposed and repaired a new
substring-target regression (申込書 vs 追加申込書), a cross-kind deadline correction
gap, and ambiguous/chained correction behavior. Additional regression assertions
preserve distinct event names (追加説明会 vs 説明会) and date-leading subjects.
Correction identity is exact after normalization; ambiguous multi-target updates
are omitted rather than selecting a prior action by position. Date-only chains
retain the latest explicit correction while preserving non-correction eligibility
and actor quotes. Conflicting richer correction histories may remain unverified.

Calendar date evidence checks now cover every temporal type, so setting a date
under `unknown`, `relative` or `range` cannot bypass verification. Short `雨天時`
and `雨天なら` preparation conditions are also preserved.

Existing 74 fixtures were not edited; the corpus now contains 84. No negative
expectation or severity was weakened. The synthetic-data guard passed.

## Safety first, then extraction coverage

Missing dependencies prevent the official full benchmark. To obtain useful
bounded evidence without stubbing the validator, the original and candidate
`extractDeterministically` and public `verifyAction` functions were bundled using
normal package `sideEffects: false` tree-shaking. Unused `verifyManifest`/AJV code
was not executed or replaced. The input canonical documents contain the synthetic
text, page/chunk references and SHA-256 source hash. Scoring uses the unchanged
repository matching/forbidden-pattern algorithms.

These are **forbidden actions passing per-action checks**, not a claim that the
full official pipeline has zero false-verified actions. Adapter validation,
manifest schema/hash/lifecycle gates, receipt generation and CLI integration were
not exercised in this comparison.

| Scope | Baseline | Candidate |
| --- | ---: | ---: |
| New 10 notices: critical forbidden per-action passes | 12 | 0 |
| New 10: expected actions matched | 11/11 | 11/11 |
| New 10: macro action recall | 100% | 100% |
| New 10: macro action precision | 65.00% | 95.00% |
| Original 74: critical forbidden per-action passes | 0 | 0 |
| Original 74: actions extracted / matched | 101 / 72 | 101 / 72 |
| Original 74: macro recall / precision | 91.89% / 76.13% | 91.89% / 76.13% |
| Expanded 84: macro recall / precision | 92.86% / 74.80% | 92.86% / 78.37% |

Every original fixture retained its per-action pass/fail sequence. A separate
14-case characterization of the original semantic helper functions found 10/10
unsafe semantic accepts before and 0/10 after, while retaining 4/4 valid controls.
That smaller diagnostic is also not a full-pipeline benchmark.

The existing approximate action matcher gives substantial credit for matching
kind alone. Recall therefore measures the repository's matching convention, not
complete semantic equivalence or real-world accuracy. These synthetic results
must not be used to claim superiority over competitors or general production
accuracy. Previously published README reference measurements are not overwritten.

## Executed checks

- Baseline temporal unit tests: 15 passed.
- Candidate temporal + isolated semantic tests + synthetic-data guard: 57 passed.
- TypeScript strict check of temporal/parser/modality and semantic helpers: passed.
- Exact extractor/public per-action functions on 84 fixtures, before and after:
  completed as scoped above.
- Separate Python `jsonschema` Draft 2020-12 check: all 168 extracted baseline/
  candidate manifests validate against the unchanged `0.2.0` schema. This is an
  independent artifact check, not a substitute for production AJV execution.
- Independent final review: 19 focused exact-public-function assertions passed,
  including distinct form/event names, date-leading subjects, cross-kind and
  chained corrections, ambiguous-target omission, eligibility, weather conditions
  and temporal-type bypass attempts. The reviewer reproduced the final public
  bundles in memory byte-for-byte.
- Frozen `0.1.0` / `0.2.0` schema SHA-256 pins: unchanged and matching.
- `git diff --check`: passed. The complete patch applies cleanly to the untouched baseline.

Reusable installed tools were Node 24.19.0, TypeScript 5.9.3 and Vitest **4.1.10**;
Vitest is not the repository-pinned **4.1.11**. No dependency was downloaded or
installed. The initial focused run exposed a predicate normalization failure
(`雨天の場合は` normalized to `雨天の`); that defect was fixed and rechecked.

## Blocked or not run

- Full unit/benchmark entrypoint failed before test collection at missing
  `ajv/dist/2020`; `ajv-formats` is also unavailable.
- Full `tsc -b` is blocked by missing `ajv`, `@xberg-io/xberg` and `commander`
  types/packages. It is not a passing full typecheck.
- Full lint, `pnpm schema:validate`, `verifyManifest` integration, CLI/consumer
  integration, docs aggregate, conformance, packaging and release checks were
  not completed. Pinned AJV is 8.20.0 and ajv-formats is 3.0.1.
- No push, PR, merge, npm publication, deployment or live alert was performed.

Before approval, run the repository's normal pinned-dependency gates:
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm schema:validate`,
`pnpm benchmark:smoke`, `pnpm benchmark`, and affected consumer integration checks.
No dependency or release gate should be relaxed to accept this candidate.

## Remaining limits

This is a bounded deterministic improvement. It does not solve arbitrary Japanese
syntax, OCR corruption, all condition expressions, unrecognized names/aliases in
correction targets, or cross-document revision ordering. The verifier checks
cancellation/corrections in the Action's supplied evidence; a provider that omits
a contradictory later quote is not generally protected by whole-document
semantic reasoning. Conservative checks can leave legitimate actions unverified.
Conditional event alternatives remain a separate existing pathway. These gaps
need further independent fixtures and real-world evaluation with appropriate
consent before enabling user-facing proactive notifications.
