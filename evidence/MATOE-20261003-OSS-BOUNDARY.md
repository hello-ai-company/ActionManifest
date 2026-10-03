# Matoe-first / reusable OSS boundary evidence

Date: 2026-10-03 UTC. Baseline: local `c873c29` on
`fix/matoe-explicit-compatibility`. AGENTS.md reviewed; no applicable local
`.agents/skills`. No additional agents or external calls were used.

## Scope and decision

Make Matoe a primary integration target without turning its current Swift display
restrictions into the shared contract. Existing public APIs already have the
required boundary: generic `classifyManifest` / `readyActions` and separately
invoked `prepareMatoeManifest`. No new profile registry, app-name abstraction,
runtime API, product identity model or package export is needed.

This follow-up changes documentation, synthetic fixtures and regression tests.
Production source, frozen schemas, default 0.2 extraction, package metadata,
dependencies, license and publishing configuration are unchanged. A source search
found no Matoe/Otayori dependency in schema/core/extractor/verifier/temporal.

## Concrete evidence

`integration/reference-consumer/test/consumer-boundary.test.ts` uses built public
package entry points, with no source aliases. Seven schema-valid handoff inputs
are exercised through the default 0.2 contract and real verifier:
guardian role, timezone, conditions, notes, distinct Evidence, rain alternatives
and approximate dates. Each verifies with its full Action data retained, is
classified ready by the generic receipt policy, and is separately refused by
Matoe with the specific representation reason. The input and the verified
manifest are unchanged by classification/refusal. Ready does not mean user
approval or complete product rendering; the consuming app owns those decisions.

An eighth case uses a complete, consistent passing receipt with a warning. The
generic consumer exposes the warning reason; Matoe refuses it rather than hide
the message. Counts and issues remain consistent; no safety gate is relaxed.

Two additional native 0.1 fixtures cover rain alternatives and approximate dates,
paired with exact UTF-8 source/hash. They are proposed/unapproved fixtures with
fixture provenance, not claimed service verification. Unit tests validate their
frozen schema and specific Matoe refusal. The existing accepted wire golden and
source are the positive control; all eight handoff fixtures are negative controls
for current projection, not claims of Swift decode failure. Unknown versions,
hash/provenance failure and approval restrictions retain their existing tests.

Docs now distinguish generic source support/trust, optional wire representability,
and product rendering/review. The 39/35 corpus result is mapped to applicant-only
and already-submitted conditions, guardian signatures, approximate schedules,
rain alternatives, cancellations/exemptions and deadline qualifiers. Counts are
first-refusal reasons, not usage frequency or independent field prevalence.

## Verification

Node 24.19.0 / pinned pnpm 11.23.0, cached offline dependencies:

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS, exit 0 |
| `pnpm typecheck` | PASS, exit 0, including external reference consumer |
| `pnpm test` | PASS, 611/611 in 52 files |
| `pnpm integration:test` | PASS, build + 33/33 in 7 files |
| `pnpm docs:check` | PASS, exit 0 |
| `git diff --check` | PASS |

No repeated performance/quality/coverage run: runtime code and the existing
74-fixture corpus are unchanged. The prior measured 39 accepted / 35 refused
and performance figures remain the `c873c29` evidence, not a new measurement.
No full release/readiness claim is made.

## Remaining Matoe work

Use the positive golden and eight native 0.1 handoffs in the actual Swift bridge,
assert values saved/displayed and confirmation reasons, not only decode success.
Prioritize guardian/conditions and all Evidence/issue display, then rich civil
date/timezone/alternative handling. A future 0.2 bridge must additionally retain
per-action verification/mixed outcomes and validate complete consistent results.
Failed or unknown verification stays blocked/review, never becomes verified.

Swift/iOS, HTTP, backend configuration/audit storage and real-device timezone/DST
remain untested. No Otayori edits, push, PR, merge, npm publication, DB/production
operation, credentials, payment or message sending occurred.
