# ADR 0008 — First-release bootstrap & OIDC transition

Status: Accepted
Date: 2026-09-10
Builds on: ADR 0007 (release versioning & supply chain)

## Context

Phase 2.3 designed the first public release as `0.9.0-rc.1` via GitHub
Actions OIDC + npm Trusted Publishing. A current npm reality blocks that
plan for the first publish:

> **A Trusted Publisher can only be configured for a package that already
> exists on the npm registry.** (docs.npmjs.com/trusted-publishers and
> docs.npmjs.com/cli — verified 2026-09-10.)

All 10 `@actionmanifest/*` names return 404. Therefore the first-ever
publish cannot use OIDC, and the release plan needs a bootstrap step.

## Decision

### 1. Two-stage first release

- **`0.9.0-rc.0` — bootstrap release.** Manual, maintainer-controlled,
  2FA-protected publish of the exact PR-reviewed tarballs, dist-tag `next`
  (never `latest`). Purpose: create the registry package identities so
  Trusted Publishing can be attached. This is a real public prerelease, not
  a throwaway.
- **`0.9.0-rc.1+` — OIDC-only releases** via GitHub Actions Trusted
  Publishing, using `release.yml` (templated now, enabled in Phase 2.4B).

### 2. The agent prepares; the maintainer publishes

Phase 2.4A adds `pnpm bootstrap:check` (version gate + read-only registry
preflight + `bootstrap-plan.json` with exact per-tarball publish commands in
the manifest's computed order). The agent never runs `npm publish`, never
creates tags/Releases, never touches npm auth, and never creates the npm
org. The bootstrap publish is a maintainer operation from
`docs/BOOTSTRAP-RELEASE-CHECKLIST.md`.

### 3. Exact-artifact publish

The approved tarball is the published tarball. Publishing re-packs nothing:
commands reference `./release-artifacts/tarballs/<file>.tgz` directly. A
locally rebuilt artifact is a different artifact and is never substituted.

### 4. No long-lived publish token ever enters CI

The bootstrap does not justify one. Release Check pins `NPM_TOKEN` /
`NODE_AUTH_TOKEN` empty; the dry-run and bootstrap:check fail closed if they
carry a value; the future `release.yml` holds `id-token: write` only on the
publish job and fails closed on any registry credential.

### 5. Current npm/GitHub requirements (verified 2026-09-10)

Recorded from docs.npmjs.com / docs.github.com (not blog posts):

- Trusted Publishing: npm CLI **≥ 11.5.1**, Node **≥ 22.14.0**; release lane
  uses Node 24 + pinned npm (the Node 20 support floor for consumers is
  unchanged).
- GitHub-hosted runners only (self-hosted unsupported).
- `id-token: write` required on the publish job.
- Package must already exist; repository / workflow filename / environment
  must match exactly (case-sensitive).
- Trusted Publisher configs created after 2026-05-20 must explicitly select
  allowed actions (`npm publish`).
- Provenance is automatic under Trusted Publishing for public repo + public
  packages — no `--provenance` flag is required (harmless if present).
- `npm trust github` CLI exists (npm ≥ 11.15.0) but still requires the
  package to exist, write access, and account 2FA.

## Consequences

- The registry identity is created exactly once, by a human, from reviewed
  artifacts — then publishing becomes OIDC-only with no token surface.
- `latest` is never touched by prereleases (`--tag next` enforced in the
  generated plan and asserted by tests).
- A partial bootstrap failure has an explicit non-destructive policy
  (RELEASING.md §10): no unpublish, no overwrite, no silent solo bump.
- Phase 2.4B enables `release.yml` only after all 10 packages exist and
  Trusted Publishers are configured — verified by a preflight step.
