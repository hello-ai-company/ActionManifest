# ADR 0009 — Reproducible release artifacts & canonical artifact

Status: Accepted
Date: 2026-09-10
Builds on: ADR 0008 (first-release bootstrap)

## Context

An independent comparison of Release Check artifacts found that tarballs
generated from the SAME git tree were not byte-identical: PR artifacts,
post-merge main artifacts, and a maintainer's local bootstrap artifact had
different SHA-256 values (evidence:
`docs/evidence/REPRODUCIBLE_RELEASE_ARTIFACTS.md`).

Root cause: pnpm ≤ 10.x packs workspace manifests with **unstable dependency
key ordering** (upstream pnpm/pnpm#10167). The `workspace:*` → release-version
rewrite produces semantically identical but byte-different
`package/package.json`, changing tarball SHA-256. Reproduced locally: 5 packs
of `@actionmanifest/cli` from one clean tree → 5 distinct hashes.

## Decision

### 1. pnpm 11.23.0 (the deterministic-pack fix)

`packageManager` is pinned to `pnpm@11.23.0` — the first release containing
the upstream fix ("Packed workspace package manifests now preserve dependency
order"). Not 12.x: unrelated changes are out of scope.

Compatibility notes (pnpm 11):

- pnpm 11 itself requires Node >= 22 to EXECUTE. The **CI/release lanes move
  to Node 22+**; the consumer-facing runtime floor is UNCHANGED (every public
  package still declares `engines.node >= 20`; adapter-xberg stays `>= 22`).
- Build allowlist moved: `pnpm.onlyBuiltDependencies` (package.json) →
  `allowBuilds` (pnpm-workspace.yaml).
- pnpm 11's default supply-chain protection (`minimumReleaseAge: 1440`)
  blocked the reviewed, exactly-pinned `@xberg-io/xberg@1.1.3` set (published
  2026-09-09, within the 24h window at migration time). The Xberg set is
  explicitly excluded via `minimumReleaseAgeExclude`; the protection itself
  stays enabled for everything else.

### 2. Reproducibility is a release gate

`pnpm release:reproducibility` packs every public package N times (10 for
release, 2 for PR quick path) into independent directories and requires
byte-identical output per package. It refuses to run on pnpm < 11.23.0 and
warns on any version other than the pinned one — release artifacts are never
built with a different toolchain.

### 3. Build once, verify once, publish exactly that artifact

- The exact-head **Release Check artifact** is the canonical release
  artifact: `release-artifacts/` from the CI run on the exact commit.
- `bootstrap:check --publish-ready` downloads that canonical artifact and
  requires the local tarball set to be byte-identical (10/10 SHA-256) —
  local rebuilds that differ from the reviewed CI artifact are BLOCKED.
- The future `release.yml` (template) no longer re-packs in the publish job:
  the verify job builds + uploads `canonical-release-<sha>`; the publish job
  downloads it, re-verifies `SHA256SUMS`, and publishes exactly those files.

### 4. Never mix artifact sets

All 10 packages in a release come from ONE canonical artifact set — never
schema from CI plus cli from local plus extractor from an older run.

## Consequences

- Same tree → same bytes → same SHA-256 is now machine-enforced before any
  publish gate can report READY.
- Artifact substitution between review and publish is eliminated by
  construction (the publish job consumes the reviewed artifact, it does not
  rebuild).
- Node 20 consumers are unaffected (engines unchanged); only the CI/release
  toolchain lane moves to Node 22+.
- Old artifact sets (pre-fix) are obsolete and must never be published.
