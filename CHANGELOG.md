# Changelog

All notable changes to this project are documented here. Schema version is independent of package versions; see `docs/SPECIFICATION.md`.

## Phase 2 — 2026-09-09

Integration Contract & Reference Adapter. No production schema version change (manifest schemas v0.1/v0.2 untouched; CanonicalDocument schema gains an optional `mediaType` and a bbox convention annotation — additive only).

### Added

- **Integration contract** (`docs/INTEGRATION-CONTRACT.md`, ADR 0004): CanonicalDocument boundary, source identity chain (`CanonicalDocument.id/sourceHash` ↔ `Manifest.source.id/hash` ↔ `Evidence.source_id`), bbox convention (normalized 0..1, top-left origin), adapter error model, consumer and export policies, public package surface, Node support (>= 20, tested on 22).
- **Canonical document validation** (`@actionmanifest/core`): `checkCanonicalDocument()` / `assertCanonicalDocument()` — empty content, duplicate page numbers, orphan chunk page refs, invalid source hash shape, out-of-convention bbox (error); text/pages mismatch (warning). `locateEvidence()` resolves quote → page/bbox/section/sourceReference.
- **Adapter error taxonomy** (`@actionmanifest/core`): `UnsupportedInputError`, `MalformedAdapterPayloadError`, `MissingSourceIdError`, `InvalidPageError`, `InvalidBoundingBoxError`, `InvalidDocumentError` (all extend `DocumentAdapterError`), plus `ExportError` (`EXPORT_BLOCKED`).
- **Docling reference adapter** (`@actionmanifest/adapters`): converts parsed Docling document JSON (texts/prov/pages, TOPLEFT/BOTTOMLEFT bboxes, section labels) into CanonicalDocument; bbox normalized only when coordinate origin and page size are known, otherwise omitted with a metadata warning. Phase 1 fixture shorthand remains supported. Explicit failures — never a silent empty document. New synthetic two-page fixture `examples/docling-school-notice.json`.
- **Reference consumer** (`@actionmanifest/consumer`): `classifyManifest()` → `ready` / `review_required` / `blocked` from the per-Action receipt; manifest-level fatal blocks every Action.
- **Integration suite** (`integration/reference-consumer`): imports only public entry points resolved against built dist; round-trip tests A–F; Integration Golden E2E (Docling JSON → adapter → extractor → verifier → consumer → exports). `pnpm integration:test`.
- **Packaging verification**: `pnpm pack:check` packs all 8 public packages offline, asserts tarball contents/exports, and runtime-smokes the extracted tarballs. Nothing is published.

### Changed

- **Exporters default to verified-only** (`exportJson` / `exportIcs`): unverified Actions require explicit `include: "all"`. A manifest-level fatal receipt throws `ExportError`. CLI `extract` gains `--include-unverified`.
- **Extractor provenance**: evidence page/bbox/section are resolved from the CanonicalDocument via `locateEvidence()` instead of hardcoded page 1; sentences that are document headings are skipped as structure. Plain-text behavior and the 74-fixture benchmark are unchanged (critical false-verified = 0).

### Hardened (PR #4 pre-merge review)

- **Shared trust policy** (`@actionmanifest/core`): `evaluateActionTrust()` is the single source of truth for "safe to consume", used by both the reference consumer and the exporters. Default export now means trust-qualified `ready` — `status=verified` with a failed per-Action receipt, verified status with no receipt, and passed-but-`proposed` Actions are withheld by default. `include: "all"` ICS entries always carry `X-ACTIONMANIFEST-STATUS` + `X-ACTIONMANIFEST-DISPOSITION`. v0.1 aggregate-only receipt handling is identical between consumer and exporter. (`EXPORTABLE_STATUSES` / `isExportableStatus` removed in favor of core `VERIFIED_TIER_STATUSES`.)
- **Conditional temporal safety**: top-level `conditional` temporals never become `DTSTART`/`DUE` — with no unconditional primary date, no VEVENT/VTODO is produced at all. Alternatives never promote to primary; dated conditional alternatives stay `COMMENT` annotations.
- **ICS UID**: now `sha256hex(source.id + ":" + action.id)@actionmanifest` — globally stable across documents, deterministic on re-export, and opaque (raw source ids never leak into calendar output). Keyed on logical source identity, not content hash (ADR 0004 §4c).

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

### Fixed (PR #3 pre-merge hardening — three position-heuristic false-verified risks)

- **Correction target is the replacement, not the chronological max**: `primaryTemporal` picks the dated temporal nearest the correction cue, correct for reverse corrections (`10/22→10/15`); unresolvable → omit.
- **Cross-sentence cancellation**: a cancellation in a later sentence deactivates the matching earlier Action (by subject/object) while preserving unrelated Actions.
- **Negation targets its subject, not the last Action**: a blanket negation binds to the Action it names (object/title identity); unresolvable → prohibited/omit, never contaminating an unrelated Action. `isExemption` narrowed so a blanket "提出は不要" is not misread as an exemption.
- Added 8 stateful adversarial fixtures (68 total) and benchmark-only failure codes `WRONG_NEGATION_TARGET` / `WRONG_CANCELLATION_TARGET`.

### Fixed (PR #3 final hardening — correction cue coverage and target identity)

- **From→to / gerund correction targets**: the resolver drops the superseded date (`Xの予定`, `Xから`, `changed from X`, `was X`) and keeps the replacement, so `XからYに変更`, `changed from X to Y`, and `…変更し、Yに実施します` resolve to Y (not the first/older date). Expanded `CORRECTION_CUE`; narrowed the `mdRe` prefix guard so a date after `から` is not suppressed by an earlier era mention.
- **English target identity**: a small canonical-target resolver (lowercase, strip punctuation / leading imperative verbs / determiners) lets a negation bind its named submit across `Please submit the permission form` / `The permission form` / `permission form` without contaminating unrelated Actions.
- Added 6 fixtures (74 total, 40 adversarial): ja correction gerund + from→to, en changed-from / revised from→to, en cross-sentence negation, en multi-submit negation.

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
