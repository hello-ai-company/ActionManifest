# Release Checklist — 0.9.0-rc.1 readiness scorecard

Status legend: **PASS** = verified by an automated gate or inspected artifact;
**READY** = prepared and documented, awaiting the gated publish phase;
**NOT READY** = open work.

Last verified: Phase 2.3 (against `main` tip
`4ad9af13e1c606a38e7da5ab4295aad8daaaf1fb` + Phase 2.3 branch). Re-run
`pnpm release:check` before trusting this table.

## Installability

| # | Item | Status |
| --- | --- | --- |
| 1 | All 10 public packages pack cleanly (`pnpm pack`) | PASS (`pack:check`) |
| 2 | Packed manifests contain no `workspace:*` ranges | PASS (asserted per tarball) |
| 3 | Tarballs contain dist runtime + `.d.ts`, LICENSE, NOTICE; no src/tests | PASS (asserted per tarball) |
| 4 | Every library installs standalone with declared deps only; `tsc --noEmit` + runtime import | PASS (9/9 standalone matrix) |
| 5 | CLI installs from tarball via real package manager; `actionman` bin shim executable | PASS (offline pnpm install, foreign cwd) |
| 6 | `actionman --help` / `--version` / `extract` / `validate` / `benchmark --smoke` work installed | PASS (install smoke) |
| 7 | `actionman conformance` passes 65/65 from the installed package with no repo checkout | PASS (bundled suite) |
| 8 | CLI does not install the native Xberg binding by default (Node 20 capable) | PASS (asserted: no `@xberg-io/*` in installed tree) |

## Package correctness

| # | Item | Status |
| --- | --- | --- |
| 9 | `bin`/`main`/`types` point at built `dist` (not `src`) | PASS (was the Phase 2.3 blocker; fixed) |
| 10 | `exports["."]` present; targets exist inside the tarball | PASS |
| 11 | `publishConfig.access = "public"` on all scoped packages | PASS |
| 12 | `engines.node` correct per package (`>=20`; adapter-xberg `>=22`) | PASS |
| 13 | `license: Apache-2.0`, `repository.directory`, `homepage`, `bugs` set | PASS |
| 14 | `sideEffects: false` on libraries; absent on CLI | PASS |
| 15 | Public `.d.ts` external references all declared as dependencies | PASS (declaration scan) |
| 16 | `@xberg-io/xberg` pinned exactly (1.1.3), enforced by gate | PASS (ADR 0007; `pack:check` fails on any range operator) |
| 17 | No circular package dependencies; publish order computed | PASS (`release:dry-run` stops on cycles) |
| 17a | Node engines separation: all packages >= 20, adapter-xberg >= 22; default CI on Node 20 | PASS (full `release:check` verified on Node 20.20.2; `xberg:integration` opt-in Node 22+) |
| 17b | Experimental markers: Xberg Layer B bridge triple-marked (README + COMPATIBILITY + JSDoc `@experimental`); Layer A labeled stable structural mapper | PASS |

## Safety gates (unchanged by this phase)

| # | Item | Status |
| --- | --- | --- |
| 18 | Unit tests 253+ | PASS (253) |
| 19 | Integration tests 20+ (public entry points, built dist) | PASS (20) |
| 20 | Universal conformance 65/65, critical false exported = 0 | PASS |
| 21 | Reference serialization 4/4 | PASS |
| 22 | Benchmark 74 fixtures / 40 adversarial, critical false-verified = 0 | PASS |
| 23 | Parser divergence = 0 (Docling vs Xberg cross-parser proof) | PASS |
| 24 | Frozen v0.1/v0.2 schemas intact (governance + sha256) | PASS |
| 25 | Normative conformance unchanged without suite_version bump | PASS (governance) |

## Supply chain

| # | Item | Status |
| --- | --- | --- |
| 26 | SHA256SUMS for all tarballs | PASS (`release:dry-run`) |
| 27 | release-manifest.json (versions, hashes, engines, dep graph, publish order) | PASS |
| 28 | CycloneDX SBOM (first-party + full external production closure) | PASS (24 components) |
| 29 | No registry credentials in repo `.npmrc` | PASS (dry-run guard) |
| 30 | Release Check workflow: `contents: read` only, SHA-pinned actions | PASS |
| 31 | No long-lived npm tokens/PATs in CI; OIDC Trusted Publishing is design-only — intended, currently unimplemented and unverified | READY (design documented in RELEASING.md §6; never claimed as enabled) |
| 32 | Provenance attestations (`--provenance`) | READY (part of the future publish command; unverified until first publish) |

## Ops constraints (Round-1, PA-20260910-001)

| # | Item | Status |
| --- | --- | --- |
| ⑥a | `release:check` is verification-only — never publishes, tags, or creates GitHub Releases; separate from any future publish workflow | PASS (pack-only; guards enforced in `release-dry-run.ts`) |
| ⑥b | Publish guards: default dry-run; `NPM_TOKEN`/`NODE_AUTH_TOKEN` present → fail closed (never used); publish argv refused; repo `.npmrc` credentials refused | PASS (enforced) |
| ⑥c | Dirty tree fails in CI (warned + recorded locally); tag-mismatch and ungated-CI guards specified for the publish path | PASS (RELEASING.md §3/§8) |
| ⑦ | CI concurrency `release-check-<ref>`; cancel-in-progress on PRs, never on main/tag/RC paths | PASS (implemented + documented) |
| ③ | Single entry `pnpm release:check`; PR quick path (`release:check:quick`) vs full path on main/tag/dispatch — no duplicated gates per PR | PASS (implemented + documented) |
| ⑤a | Artifacts named `release-check-<sha>`; retention 14d PR / 90d main+RC | PASS (workflow) |
| ⑤b | Binaries never committed to the repo (`release-artifacts/` gitignored) | PASS |
| ⑧ | Retention + evidence summary path documented (RELEASING.md §3 "Artifacts & evidence"; evidence/ dirs are Eng-ops-only per PUBLIC-BOUNDARY) | PASS |

## Documentation / DX

| # | Item | Status |
| --- | --- | --- |
| 33 | README install section reflects unpublished/RC state honestly | PASS |
| 34 | Library + CLI quick starts executable (`docs/examples/`, CI-run) | PASS |
| 35 | Adapter author guide copy/paste-correct | PASS (import fixed) |
| 36 | SECURITY.md factual (supported versions, scope, no sandbox claims) | PASS |
| 37 | SUPPORT.md routes bug / security / usage / feature | PASS |
| 38 | RELEASING.md runbook complete (this file's sibling) | PASS |
| 39 | API entry-point reference (docs/API.md) | PASS |
| 40 | Compatibility table (package ≠ schema ≠ suite; Node; Xberg) | PASS (COMPATIBILITY.md) |
| 41 | Known limitations + experimental markers documented | PASS (README) |

## Not yet done (by design — the publish phase)

| # | Item | Status |
| --- | --- | --- |
| 42 | Version bump to `0.9.0-rc.1` across all 10 packages | NOT READY (deferred to the release phase per plan) |
| 43 | npm Trusted Publishing configured on npmjs.com | NOT READY (requires npm org admin) |
| 44 | Live OIDC publish workflow (`.github/workflows/release.yml`) | NOT READY (intentionally not enabled) |
| 45 | Tag `v0.9.0-rc.1` + GitHub Release | NOT READY (post-publish step) |
| 46 | Post-publish registry verification | NOT READY (after first publish) |
