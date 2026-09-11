# 0.9.0-rc.0 bootstrap release record (2026-09-11)

Case: PA-20260911-001 / ENG-20260911-001. Phase 2.4B evidence pack.

This note records what the first public bootstrap **actually** did. It does
not invent a git tag, a GitHub Release, provenance attestations, or a
staged-publish flow — none of those existed for rc.0.

## Status (COMPLETE)

| Claim | Fact |
| --- | --- |
| 10/10 `@actionmanifest/*` packages on npm at `0.9.0-rc.0` | YES (registry READ 2026-09-11) |
| Canonical source HEAD | `c0030b71e7497eb7e53b9348fa7101733f025b85` |
| Canonical git tree | `918112608e35ba5d59cc47302324f71263280848` |
| Git tag `v0.9.0-rc.0` | **NO** — none created |
| GitHub Release | **NO** — repository has zero Releases |
| npm provenance / Trusted Publishing | **NO** — first publish was manual maintainer 2FA |
| Staged publish (`npm stage`) | **NO** — not used for rc.0 |
| Dist-tags | `next=0.9.0-rc.0` **and** `latest=0.9.0-rc.0` (see incident F) |

## Incidents A–H (design debts this phase hardens)

### A — macOS vs Linux canonical bytes

Operator-machine `pnpm pack` (including macOS) is **not** the publish
artifact. Same tree can still be the wrong *bytes* if packed off the
canonical lane. Rule: **BUILD ONCE** (GitHub Actions `ubuntu-latest`,
Node >= 22, pnpm 11.23.0) / **VERIFY ONCE** / **STAGE EXACT ARTIFACT**.
Never rebuild on a laptop and publish that rebuild.

### B — `bootstrap:check --publish-ready` used to local-pack

`--publish-ready` previously ran `pnpm release:dry-run` (local pack) and
only *compared* SHA256SUMS to CI. Phase 2.4B: `--publish-ready` does **not**
pack. It resolves exact-head CI + Release Check, downloads
`release-check-<sha>`, verifies SHA256SUMS + manifest + 10 tarballs +
`publish_order`, and writes a plan that points at those downloaded files.
`--prepare` may still pack locally and must be labelled NON-CANONICAL.

### C — CLI timeout ≠ publish failure

A timed-out `npm view` / packument GET is **UNKNOWN**, not “publish
failed”. Do not republish because a CLI hung. Read the registry first.

### D — New scoped-package packument lag

After a first scoped publish, packument 404s can persist briefly.
Bounded read retries classify this as PROPAGATING / ABSENT — **never**
republish solely to chase packument lag.

### E — Consumer install cache pollution

Consumer proof must use a **fresh temp npm cache** and `--prefer-online`.
Never mutate the operator’s global `~/.npm` cache.

### F — First publish set `latest=rc.0`

Observed on 2026-09-11 for all 10 packages:

```
dist-tags = { next: '0.9.0-rc.0', latest: '0.9.0-rc.0' }
```

npm’s first publish of a package historically also creates `latest`.
**Document only. Do not auto-repair dist-tags.** Subsequent prereleases
must stage/publish with `--tag next` and verify `next=version`. Stable
releases must require `latest=version`. This repo will not run
`npm dist-tag` add/rm/replace as part of hardening.

### G — Release Check must prove Node 20 via npm

The canonical pack lane needs Node >= 22 (pnpm 11). That must not be
confused with the consumer floor. Release Check now has a **Node 20 +
npm-only** job that installs the canonical tarballs (excluding
`adapter-xberg`) and runs imports + `actionman --version` + conformance
65/65. That job must not require pnpm 11.

### H — Xberg native smoke was not a release gate

`pnpm xberg:integration` was opt-in and explicitly “not default CI”.
Release Check now has a **Node 22+ native gate** on the same canonical
`adapter-xberg` tarball (synthetic file + bytes fixtures, 2/2 PASS).
Default `pnpm test` stays portable (no native binding).

## What this record is not

- Not a GitHub Release body.
- Not a provenance statement.
- Not permission to bump off `0.9.0-rc.0` or to cut `rc.1`.
- Not a publish / stage / approve / dist-tag mutation log.
