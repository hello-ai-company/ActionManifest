# Changelog

All notable changes to this project are documented here. Schema version is independent of package versions; see `docs/SPECIFICATION.md`.

## Phase 1.2 — 2026-09-09

Adversarial Document Reliability Benchmark (evaluation only — no production schema change).

### Added

- **Adversarial benchmark** (`apps/cli/src/adversarial.ts`): benchmark-only `must_not_extract` negative expectations, a failure taxonomy, severity (critical/high/medium), and the **False Verified Action** safety metric.
- 26 synthetic adversarial fixtures (JA 16 / EN 10; 60 total) across correction, extension, cancellation, negation, conditional eligibility, exemption, conditional date, reference-only, quoted-old-instruction, OCR noise, approximate date, postmark vs arrival, modality scale, repeated actions, multiple dates, and cross-action contamination.
- A 10-fixture **Adversarial Golden Set** run in CI smoke; new benchmark metrics (falseVerifiedActionRate, forbiddenActionRate, staleActionRate, duplicateActionRate, correctionResolution, negationPreservation, conditionalPreservation, criticalFalseVerified) and an action-level structure.
- CI runs the full `pnpm benchmark`; **any critical false-verified action fails the build**.
- `docs/ADVERSARIAL-BENCHMARK.md` (methodology + integrity guard) and ADR 0003. Integrity rule: *Expected truth is normative; extractor output is not the oracle.*

### Fixed (minimal, discovered by the adversarial corpus)

- **Correction / extension**: `primaryTemporal` selects the corrected (later) date; a superseded date is never verified as active.
- **Cancellation / reference / quotation / completed-past**: the deterministic extractor skips these sentences instead of emitting an active Action.
- **Blanket contradiction**: a required submit negated for everyone ("提出は不要" / "no longer required") is a verification conflict; genuine eligibility / prior-submission exemptions still verify.

## Phase 1.1 — 2026-09-09

Per-Action Verification Semantics Hardening. Schema `0.2.0` (additive; `0.1.0` still accepted).

### Added

- **Per-Action verification.** `ActionVerificationResult` and `verifyAction()`; each Action is verified independently.
- Manifest verification receipt gains optional `passed`, `total_actions`, `verified_actions`, `failed_actions`, `warning_actions`, `actions[]` (schema `0.2.0`, backward compatible).
- `actionVerificationPassed()` API; `verificationPassed()` retained as the manifest-level verdict.
- CLI `actionman validate` shows `PARTIAL` with per-Action `[VERIFIED]/[FAILED]` and reasons; `--json` exposes per-Action results.
- Benchmark: 5 new synthetic fixtures (mixed-validity, approximate-vs-hallucinated, actor-explicit, conditional-negation-exemption, optional-eligibility; 34 total) and an action-level `actionVerificationRate`.
- ADR 0002 (per-Action verification): fatal vs per-Action failure classification, schema-versioning rationale, actor semantics.

### Changed

- **Status promotion is per Action.** `proposed → verified` only when that Action passes AND there is no manifest-level fatal failure. Removes the global "promote all if everything passed" behavior.
- v0.1 aggregate booleans are retained as a backward-compatible summary (AND/OR across Actions); meaning unchanged.

### Fixed

- `actor.certainty=explicit` now requires `actor.text` present **and** found in the Action's evidence (was silently accepted when missing). `implicit` text stays optional; `unknown` never invents an actor.
- Source hash mismatch / empty document are treated as manifest-level fatal: no Action is promoted, and the cause is reported without falsely blaming per-Action checks.

### Fixed (PR #2 pre-merge hardening)

- **Evidence source identity.** A mismatched Evidence `source_id` is now a **per-Action** verification failure (`EVIDENCE_SOURCE_ID`, severity `error`) that sets `evidence_supported=false`, even when the quote appears in the text (was a warning only). Stays per-Action; not manifest-level fatal.
- **Immutable versioned schemas.** Each `schema_version` maps to its own frozen schema (`schemas/v0.1/`, `schemas/v0.2/`); `validateActionManifest()` dispatches by version and fails closed on non-object / missing / unknown versions. A `0.1.0` manifest can no longer carry v0.2-only fields (the previous single-schema `enum` allowed it).

## 0.1.1 — 2026-09-09

### Added

- ENG-20260909-001 completion gates (synthetic Golden, public boundary, Core no external writes, no Otayori logic, evidence pack)
- `docs/PUBLIC-BOUNDARY.md` (public repo: OSS + synthetic fixtures + spec only)
- Placeholder `evidence/ENG-20260909-001/` for Eng ops after PA-03E review
- Guard tests for synthetic fixtures and Core I/O


## 0.1.0 — 2026-09-09

### Added

- Action Manifest JSON Schema v0.1.0
- Canonical Document model and Plain Text adapter
- Docling adapter interface + fixture mapping (no live OCR)
- Deterministic verifier (evidence, temporal, actor, modality, hash, pages, negation)
- Japanese-first temporal/modality parser
- Extractor with deterministic provider + OpenAI-compatible provider
- JSON and ICS (VEVENT/VTODO) exporters
- `actionman` CLI: extract, validate, benchmark
- 28 synthetic JP/EN benchmark fixtures including Golden Fixture
- GitHub Actions: lint, typecheck, test, schema validation, benchmark smoke
