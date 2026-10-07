# 0.9.0-rc.1 candidate — 2026-10-07

## Identity and scope

- Existing main: `cf2f3f48b515bd7aed8f02f0e8843ca97840b1bb` (merged PR #15).
- Recovery input snapshot follow-up: `50cadbbb0699f3ac07c3e28d00ba664085c8b6e2`.
- Candidate branch: `release/0.9.0-rc.1`; all 10 public packages are `0.9.0-rc.1`.
- Schema versions, universal suite version/vectors, consumer engines, native
  Xberg pin, release workflow and control-plane fingerprint are unchanged.
- Existing branches and artifacts are retained. No Matoe repository edits.

## Dependency audit and review

- Official registry preflight found only `0.9.0-rc.0` for all 10 public packages.
  Historical `latest=rc.0` was observed and not changed. Candidate is unpublished.
- Production audit initially found fast-uri `3.1.7`; locked resolution is `3.1.8`.
- Full development audit also found vulnerable Vitest/Tinypool,
  brace-expansion and source-map-js. Vitest `4.1.11` removes Tinypool;
  brace-expansion `1.1.21` / `5.0.12` and source-map-js `1.2.2` are fixed patches.
- Final `pnpm audit --json`: zero advisories (212 dependency entries).
- Frozen install passes pnpm supply-chain policy; no policy exceptions added.
- Lock regeneration refreshes upstream libc metadata and optional peer
  identities without changing those packages' versions or integrity.
- Existing consumer locks need their own audit/update; repository lock changes
  do not retroactively modify installed applications.
- Independent review checked version/hash/provenance/approval rejection,
  fabricated evidence, source mutation binding and no-fetch isolation.
- Six native Xberg platform metadata entries at `1.1.3` declare MIT. Offline
  SBOM missing license entries for uninstalled platforms are metadata limits;
  this does not certify all native shared-library licenses or platform execution.

## Exact-candidate verification

Run `pnpm release:check` from a clean candidate. Record final SHA, exit status,
counts and tarball checksums externally / in the PR so the evidence matches that
exact commit. Earlier local FULL attempt stopped on an obsolete test asserting
`rc.0`; that guard now verifies name/version lockstep across all 10 packages.
Final results are pending until the command finishes and CI confirms them.

## Publication boundary

Read-only `pnpm release:setup --check-agent` currently returns exit 2: this
execution environment cannot read GitHub control-plane state through the
existing gh authentication. READY/live-approved hash are unknown here. This is
an access blocker, not evidence that remote settings are absent. No new auth,
permission grants, control-plane writes, tag or staged publication occurred.

Approved sequence remains exact-main-SHA FULL artifact → protected immutable
version tag → existing `release.yml` stage dispatch → human 2FA approval →
official registry/provenance/integrity plus fresh consumer verification. Do not
publish from local dry-run artifacts or bypass the release controller.

Matoe Mac integration at `6c6ecb7` was reported successful by the parent workflow;
this environment independently verifies offline contracts, not device or live
production service execution. Demo pay/reply are not payment/message delivery.
