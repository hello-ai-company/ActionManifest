# Changelog

All notable changes to this project are documented here. Schema version is independent of package versions; see `docs/SPECIFICATION.md`.

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
