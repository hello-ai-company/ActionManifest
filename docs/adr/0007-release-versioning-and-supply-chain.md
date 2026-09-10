# ADR 0007 — Phase 2.3: Release versioning & supply-chain policy

Status: Accepted
Date: 2026-09-10
Builds on: ADR 0004 (integration contract), ADR 0005 (standards/conformance), ADR 0006 (parser independence/Xberg)

## Context

Phase 2.3 moves the monorepo from "works in the repo" to "third parties can
install it and we can release safely". Three decisions needed to be fixed
before the first publish: how the 10 packages are versioned relative to each
other, how the native Xberg dependency is constrained, and how release
artifacts are produced and verified without ever risking an accidental
publish.

## Decision

### 1. Lockstep (fixed) versioning for all `@actionmanifest/*` packages

All 10 public packages share one version per release (first:
`0.9.0-rc.1`). Rationale:

- **One coherent line.** The packages are designed to be consumed together
  (CLI depends on 5 libraries; extractor/verifier/exporters interlock via
  the manifest contract). Independent versioning would force consumers to
  solve a compatibility matrix we ourselves only ever test in lockstep.
- **The verified matrix is the shipped matrix.** `pack:check` and the
  install smoke prove one specific combination; lockstep makes that
  combination the only one.
- **Internal deps are exact.** pnpm rewrites `workspace:*` to the exact
  version at pack time, so a published CLI can never resolve a library
  version we did not test.

Trade-off accepted: unchanged packages re-publish (e.g. `schema` bumps even
when frozen). The cost is noise; the benefit is a single version to reason
about, one tag, one changelog section.

Exception: `adapter-xberg` MAY take a solo patch/minor bump when the Xberg
pin needs an out-of-band fix (e.g. `0.9.0-rc.2` for that package only). It
is the one package with a heavy external native dependency whose upstream
cadence we do not control. Any such bump is documented in CHANGELOG.

### 2. `@xberg-io/xberg` is pinned exactly (1.1.3), not `^`

The adapter contract was verified against the **installed 1.1.3 type
definitions** (ADR 0006), not against documentation. A `^1.1.3` range would
silently accept future 1.x releases at install time. For a native
(Rust/napi) dependency whose result model feeds the CanonicalDocument
boundary, silent drift is a supply-chain and correctness risk an RC must not
float on:

- Exact pin → the version we verified is the version consumers install.
- Upgrades are deliberate: bump the pin, re-verify against the new installed
  types, run the cross-parser equivalence proof, note it in CHANGELOG.
- Xberg's own platform binaries are its `optionalDependencies`; the pin
  covers them via lockstep upstream versioning.

### 3. Release artifacts are produced by a dry-run that cannot publish

`pnpm release:dry-run` (and the Release Check workflow) produce the exact
tarballs + SHA256SUMS + release manifest + CycloneDX SBOM and verify them by
installing into fresh projects — but the tooling runs `pnpm pack` only,
refuses argv containing "publish", and fails if the repo `.npmrc` carries
registry credentials. The live publish path is OIDC Trusted Publishing
(`id-token: write`, `--provenance`), specified in
[../RELEASING.md](../RELEASING.md) and intentionally not enabled yet. No
long-lived npm tokens exist in this repository or its CI.

### 4. The CLI bundles the conformance suite and benchmark corpus

`@actionmanifest/cli` ships `conformance/` (normative vectors + meta-schemas)
and `benchmark/fixtures/` (synthetic corpus) inside its tarball, resolved
package-relative before any cwd-relative location. Conformance is therefore
runnable by any installed CLI from any directory — the suite travels with
the tool. The repository `conformance/` remains the single source of truth;
the bundled copy is staged at pack time (prepack) and removed afterwards
(postpack), never committed, so governance guards are unaffected.

## Consequences

- Consumers pin one version number; the CLI and libraries always match.
- A future Xberg API change cannot break installs silently — it fails at
  upgrade time, in the open, behind a deliberate pin bump.
- Release readiness is provable offline: source → pack → fresh install →
  use, on every PR.
- The publish step remains a separate, human-gated, OIDC-only phase.

## Alternatives considered

- **Independent per-package versioning**: rejected — untested version
  combinations become installable; consumer confusion; no single line to
  attest.
- **`^` range on Xberg**: rejected — silent native API drift; the RC should
  fail closed.
- **Separate `@actionmanifest/conformance` package**: rejected for now — the
  suite is 380 KB and travels with the CLI; one fewer package to publish.
  A standalone suite package remains possible later without breaking
  anything (the CLI would depend on it).
- **Committing LICENSE/NOTICE copies per package**: rejected — duplication
  drift; staged at pack time instead (single source of truth at the root).
