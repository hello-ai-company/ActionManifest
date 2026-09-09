# Changelog

All notable changes to this project are documented here. Schema version is independent of package versions; see `docs/SPECIFICATION.md`.

## Phase 2.3 — 2026-09-10

Release Readiness & Developer Experience. No schema change (v0.1/v0.2 frozen); conformance suite unchanged (0.2.0); **no publish** — release-candidate preparation only. Package versions remain `0.1.0`; the first public version (`0.9.0-rc.1`) is selected in the release phase per `docs/RELEASING.md`.

### Fixed (BLOCKER)

- **`@actionmanifest/cli` was unpublishable**: `bin`/`main`/`types` pointed at `./src/index.ts` while `files` only shipped `dist` — an installed CLI could not start. Entry points now target `./dist/index.js` / `./dist/index.d.ts`, the shebang is preserved in the built entry, and compiled test files are excluded from `dist`.

### Added

- **Bundled suites in the CLI**: the normative conformance suite (65 universal vectors + meta-schemas) and the synthetic benchmark corpus ship inside the `@actionmanifest/cli` tarball, staged at pack time from the repository's single source of truth. `actionman conformance` and `actionman benchmark` run from any cwd with no repo checkout (package-relative resolution first). Custom `--root` suites must now be self-contained (manifest + meta-schemas + vectors); vectors validate against their own suite's meta-schemas.
- **Release dry-run tooling**: `pnpm release:dry-run` packs all 10 public packages into `release-artifacts/` and writes `SHA256SUMS`, `release-manifest.json` (versions, hashes, engines, dependency graph, computed topological publish order — stops on cycles), and a CycloneDX 1.5 SBOM (first-party + full external production dependency closure). Pack-only: refuses `publish` argv, fails on registry credentials in the repo `.npmrc`, never touches the registry.
- **`pnpm release:check`**: one command composing every existing gate (governance, lint, typecheck, schema, unit, integration, conformance, reference serialization, benchmarks, pack:check, docs examples, dry-run).
- **Release Check CI workflow** (`.github/workflows/release-check.yml`): `contents: read` only, SHA-pinned actions, uploads dry-run artifacts with 7-day retention. No `id-token`, no publish — OIDC Trusted Publishing is documented for the future release phase.
- **Executable docs examples** (`docs/examples/`): the README library flow and per-Action verification flow, typechecked and run by `pnpm docs:examples`.
- **Docs**: `docs/RELEASING.md` (full runbook: preconditions, version axes, publish order, OIDC Trusted Publishing prerequisites, tag strategy, post-publish verify, rollback & partial-publish policy), `docs/RELEASE-CHECKLIST.md` (readiness scorecard), `docs/API.md` (entry-point reference), `SUPPORT.md`, ADR 0007 (lockstep versioning + exact Xberg pin + supply-chain policy), per-package READMEs for all 10 packages.

### Hardened

- **`pack:check` now covers all 10 public packages** (was 9, no CLI): per-tarball metadata assertions (license, repository.directory, engines, publishConfig.access, sideEffects), LICENSE+NOTICE presence, no compiled test artifacts, CLI bin wiring + shebang, Xberg containment, and a standalone consumer matrix — every library installed from its tarball with **declared dependencies only**, then `tsc --noEmit` AND a runtime import. New CLI install smoke: real offline `pnpm install` of the tarball into a fresh project, bin shim exercised from a foreign cwd (extract/validate/conformance/benchmark, `--json` purity, exit codes 0/1/2, no `@xberg-io` in the installed tree).
- **Package metadata**: all public packages now carry `license: Apache-2.0`, `repository` with monorepo `directory`, `homepage`, `bugs`, `engines` (`>=20`; adapter-xberg `>=22`), `publishConfig.access: "public"`; libraries declare `sideEffects: false`. LICENSE + NOTICE are staged into every tarball at pack time (Apache-2.0 distribution requirement).
- **`@xberg-io/xberg` pinned to exactly `1.1.3`** (was `^1.1.3`): the adapter contract was verified against the installed 1.1.3 types; a range would silently accept future native releases (ADR 0007).
- **Ops Round-1 constraints (PA-20260910-001)**: `release:check` is verification-only and fails closed if `NPM_TOKEN`/`NODE_AUTH_TOKEN` are present (never used), on `publish` argv, on repo `.npmrc` credentials, and on a dirty git tree in CI. Release Check workflow: per-ref concurrency (`release-check-<ref>`, cancel-in-progress on PRs only — main/tag/RC runs never cancel), PR quick path (`release:check:quick` = pack:check + docs examples + dry-run; full chain already covered by CI) vs full `release:check` on main/tag `v*`/workflow_dispatch, artifacts named `release-check-<sha>` with 14d (PR) / 90d (main/RC) retention. Publish-path guards (dirty tree, tag mismatch, ungated CI) specified in `docs/RELEASING.md` §8.
- **CTO Round-1 decisions (PA-20260910-001)**: PUBLIC-BOUNDARY stays HARD — "publishable" now explicitly means "OK to commit to the public repo", never npm-publish permission. Triple experimental marking (package README + `docs/COMPATIBILITY.md` + JSDoc `@experimental`): `XbergAdapter` Layer B native runtime bridge (dynamic NAPI import) is experimental for the 0.x line; Layer A `mapXbergResultToCanonical` is labeled separately as the stable structural mapper. `pack:check` now enforces the exact `@xberg-io/xberg` pin (range operators fail the gate). Default CI lane moved to **Node 20** (the supported floor; verified locally on Node 20.20.2); `pnpm xberg:integration` remains the opt-in Node 22+ lane. CLI install smoke made deterministic across environments (consumer pins `packageManager: pnpm@10.14.0`; overrides live in `pnpm-workspace.yaml`, the supported settings home in pnpm 10+).
- **Compliance Round-1 security factual audit (PA-20260910-001)**: SECURITY.md no longer uses "published" for the source line — it now states the verified facts ("As of 2026-09-10: no npm publish, no git tag, no GitHub Release"; scope 404-verified read-only; root `private: true`; no publish workflow exists). CLI path-safety scope narrowed to *unexpected* resolution outside intended fixture/conformance roots; intentional caller-passed paths are explicitly out of scope; explicit "no sandbox claims" statement. Trusted Publishing/OIDC documented as design-only — intended, currently unimplemented and unverified; never claimed as enabled; no long-lived tokens/PATs in CI. README/COMPATIBILITY wording aligned ("once published (planned, not yet available)"; "shipped (frozen) schema versions" with the no-npm-publish note).
- **Meeting Round-2 (locked)**: the evidence/completion gate ⑤ must be satisfied **BEFORE any merge recommendation** (not after review/merge). PRs stay DRAFT until all gates including evidence completion are GREEN. Updated `docs/ENG-20260909-001.md`, `docs/PUBLIC-BOUNDARY.md`, `docs/RELEASING.md` §3, and `docs/RELEASE-CHECKLIST.md` (new merge-recommendation preconditions section). Added OSS-safe placeholder `evidence/ENG-20260910-001/README.md` recording the rule (Eng ops fills evidence content; agents never write it).
- **President+ChatGPT review fixes (PA-20260910-001)**: (1) Package identity — removed every bare `npx actionman …` example (npx would treat the first positional as the package specifier and could fetch the unrelated unscoped `actionman` package); docs now use the installed bin (`actionman …`) or the explicit one-shot form (`npx --package=@actionmanifest/cli -- actionman …`). New `pnpm docs:check` gate (CI + release:check) fails on the forbidden pattern; unit-tested. (2) Tag/publish ordering unified on tag-triggered: version PR merge → exact-commit CI green → create/push tag → tag-triggered release workflow → full validation → npm publish; a failed publish leaves the immutable tag in place (never moved/deleted) — retry the workflow or cut the next RC. Release Check `v*` wording corrected to "tag / pre-publish verification". (3) SBOM is now validated against the OFFICIAL CycloneDX 1.5 JSON Schema — vendored offline under `scripts/vendor/` (bom + spdx + jsf sub-schemas) — inside `release:dry-run`; a deliberately broken SBOM fails (negative tests in `scripts/sbom-validate.test.ts`). (4) Gate ⑤ consistency: no Eng-ops evidence exists under `evidence/ENG-20260910-001/` yet, so ⑤ stays OPEN; report verdict separates technical readiness (green) from the org merge-recommendation gate (open) — no invented evidence.
- **CLI**: `--version` reads package.json (no drift); `validate --json` without `--doc` emits pure JSON; errors stay on stderr with distinct exit codes (1 user/IO error, 2 verification/conformance-runner).
- **SECURITY.md**: factual supported-versions (nothing published yet; RC prep), explicit scope (verification bypass, source leakage, CLI path handling with no-sandbox caveat, schema bypass, supply chain, remote Xberg opt-in), private reporting path.
- **README**: honest install section (not-yet-published; commands verified by dry-run), npm package names, Node/engine matrix, `actionman` name note (unscoped npm name belongs to an unrelated project).

## Phase 2.2 — 2026-09-09

Parser Independence & Xberg Reference Adapter. No schema change; conformance suite unchanged (0.2.0); no release.

### Added

- **`@actionmanifest/adapter-xberg`** (new package, 9th public package): Xberg (`@xberg-io/xberg` 1.1.3, API verified from installed types) as the second independent parser. Two-layer design — pure `mapXbergResultToCanonical()` (structural validation, no native binding, no network) + `XbergAdapter` runtime bridge (dynamic import; remote URLs require explicit `allowRemote: true`). Caller-supplied source identity; sections from title/heading elements; `sourceReference` from element ids; pages only when upstream provides them; **bbox omitted** (unknown coordinate system — unknown stays unknown); multi-document results rejected (`MULTIPLE_DOCUMENTS`).
- **Cross-parser equivalence proof** (`integration/reference-consumer/test/cross-parser.test.ts`): same logical notice via Docling and Xberg → identical semantic Action projection, trust dispositions, and executable calendar dates; **critical parser divergence = 0**.
- **Docs**: `docs/PARSER-INDEPENDENCE.md`, `docs/ADAPTER-XBERG.md`, `docs/ADAPTER-AUTHOR-GUIDE.md`, ADR 0006.
- **AdapterInput contract**: new `xberg-uri` / `xberg-bytes` / `xberg-result` input kinds (type-level only; the core adapters package carries no Xberg dependency).
- **`pnpm xberg:integration`**: opt-in live native-runtime tests (excluded from the default suite to keep CI portable/deterministic).

### Hardened

- `pnpm pack:check` now packs 9 packages, smoke-tests the Xberg pure mapper from the extracted tarball without loading native code, and fails if any `@xberg-io/*` dependency leaks into a non-adapter package.

### Hardened (PR #6 review)

- **Standalone package typing**: `@actionmanifest/adapter-xberg` now declares `@actionmanifest/adapters` (its public `.d.ts` references `DocumentAdapter`) with matching tsconfig project references. `pack:check` gained a declaration dependency scan (every external package referenced from shipped `.d.ts` must be declared) and a standalone consumer proof (tarball + declared deps only → `tsc --noEmit` + runtime smoke, no monorepo hoisting).
- **Generic adapter contract**: `DocumentAdapter<I = AdapterInput>` — third-party adapters define their own input type without editing the central package. The central `AdapterInput` union now covers only built-in reference adapters (plain text, Docling); Xberg-specific input types (`XbergAdapterInput` / `XbergUriInput` / `XbergBytesInput` / `XbergResultInput`) moved into `@actionmanifest/adapter-xberg` and are publicly exported. Compile-only third-party proof (`ExampleMarkerAdapter`) typechecked in CI.

## Phase 2.1 — 2026-09-09

Standards & Conformance Hardening. No schema version change (v0.1/v0.2 frozen, now checksum-pinned); no package release.

### Added

- **Conformance suite** (`conformance/`, suite version 0.1.0): 65 language-neutral, spec-derived vectors across six profiles — schema (11), canonical-document (13), evidence (6), trust (11), temporal (12), ics (12) — including byte-exact ICS goldens under an injected clock. Implementations MAY run their own runner; conformance is defined by vectors + normative docs, not TypeScript internals.
- **Conformance runner & CLI**: `actionman conformance [--smoke] [--json]`, `pnpm conformance` / `pnpm conformance:smoke`. Exit codes: 0 conformant / 1 conformance failure / 2 runner error. New safety invariant: **critical false exported = 0** (no blocked/review_required Action may reach the default executable export).
- **Frozen schema integrity**: `packages/schema/schemas/checksums.json` pins sha256 of the v0.1/v0.2 manifest schemas; `pnpm schema:validate` fails on drift. Draft 2020-12 `$schema` declaration asserted for all published schemas.
- **Docs**: `docs/STANDARDS.md` (RFC 5545 mapping + known deviations, JSON Schema dialect), `docs/CONFORMANCE.md`, `docs/COMPATIBILITY.md` (schema ≠ package ≠ suite versioning, deprecation/extension policy), ADR 0005.

### Hardened (PR #5 final governance review)

- **Universal vs reference serialization split**: the `ics` profile is now semantic-only (component/property comparison via a minimal RFC 5545 reader — property order, PRODID, fold positions, DTSTAMP lexical details are implementation freedom). The 4 byte-exact golden vectors moved to a new `reference-serialization` profile: TypeScript regression only, never part of universal conformance. `actionman conformance` = universal; `--reference` / `pnpm conformance:reference` adds the regression gate. JSON report carries `scope` + `reference_serialization`.
- **Vector self-validation**: `conformance/schema/` adds Draft 2020-12 meta-schemas (suite manifest + one per profile, `additionalProperties: false`). Every vector is validated before execution; typo'd/unknown expectation fields, missing ids, unknown profiles, and directory/profile mismatches are runner/config errors (exit 2). The meta-schemas are part of the language-neutral contract.
- **Governance-enforced immutability** (`pnpm governance:validate`, CI-gated): frozen v0.1/v0.2 schema paths MUST NOT appear in a base diff — editing `checksums.json` can no longer bless a frozen edit (checksums remain as corruption detection). Normative conformance contents changed + unchanged `suite_version` → CI fails; reference-serialization goldens are exempt.
- **Suite version 0.1.0 → 0.2.0** for the profile split + meta-schema introduction; bump policy revised (patch = editorial only; minor = new normative vectors/profiles; major = changed existing expectations).

### Fixed

- **ICS folding is now RFC 5545 §3.1 octet-aware**: physical lines ≤ 75 UTF-8 octets (previously counted JS characters — a 74-char Japanese line was 222 octets), continuation lines SPACE-prefixed, multi-byte sequences never split, `unfold(fold(x)) === x`. Property-tested over 500 deterministic pseudo-random Unicode strings.
- **TEXT escaping hardened**: CR/LF/CRLF all become escaped `\n` (property injection impossible — hostile `BEGIN:VEVENT` title tested); C0/C1 control characters stripped except TAB.
- **Strict calendar-date gate**: only real `YYYY-MM-DD` dates (leap-day aware) become DTSTART/DUE; `2026-13-40`, `2026/10/15`, `2026-02-31` produce no artifact.
- **Deterministic DTSTAMP**: `exportIcs` accepts `options.now` (injectable clock); same manifest + same clock = byte-identical ICS.

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
