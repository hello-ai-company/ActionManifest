# Releasing ActionManifest

This runbook governs publishing the `@actionmanifest/*` packages to npm and
cutting the corresponding GitHub Release. It is written for the **first
public release** (release candidate) and for every release after.

> **Golden rule: prepare releases; never improvise them.** Everything up to
> the actual `pnpm publish` is automated and verified by
> `pnpm release:check`. The publish step itself is a separate, gated,
> human-triggered phase.

## 0. Version axes — read this first

Three independent version axes (details: [COMPATIBILITY.md](COMPATIBILITY.md)):

| Axis | Current | Bumps when |
| --- | --- | --- |
| npm **package version** (all 10 packages, lockstep) | **`0.9.0-rc.0`** (on npm; no tag/Release) | any code/packaging change |
| Manifest **schema version** | `0.1.0`, `0.2.0` (frozen) | never in a release — new schema = new versioned directory, separate governance |
| **Conformance suite version** | `0.2.0` | normative vector/meta-schema changes (governance-enforced) |

A release NEVER changes a frozen schema or normative conformance contents.
If a release seems to require one, **STOP** — that is a schema/suite phase,
not a release.

### First public versions: `0.9.0-rc.0` (bootstrap) then `0.9.0-rc.1` (OIDC)

Rationale (ADR 0007 + ADR 0008): the contract is conformance-gated and
stable enough to publish, but pre-1.0 signals "no stability promise beyond
the conformance suite". **npm reality (verified against docs.npmjs.com,
2026-09): a Trusted Publisher can only be attached to a package that ALREADY
exists on the registry.** Therefore the first-ever publish cannot use OIDC:

```
0.9.0-rc.0  — COMPLETE (2026-09-11): 10/10 packages on npm.
              Manual maintainer 2FA. No git tag, no GitHub Release, no
              provenance, no staged publish. Dist-tags: next=rc.0 and
              historically latest=rc.0 (do not auto-repair).
Next        — version PR → main CI → Release Check (canonical tarballs
              ONCE) → Node20 + Xberg gates on that artifact → human tag
              → workflow_dispatch release.yml mode=stage → OIDC
              `npm stage publish <canonical.tgz>` → human 2FA
              `npm stage approve` → mode=verify → GitHub Release last.
```

See [evidence/RC0_BOOTSTRAP_RELEASE_2026-09-11.md](evidence/RC0_BOOTSTRAP_RELEASE_2026-09-11.md)
and [RELEASE_TRUSTED_PUBLISHING_SETUP.md](RELEASE_TRUSTED_PUBLISHING_SETUP.md)
(`pnpm release:setup --check` / `--apply` is the preferred control plane;
the UI is break-glass). This phase does **not** bump off `0.9.0-rc.0`.

All 10 packages share one version (**lockstep / fixed versioning**) — one
coherent `@actionmanifest/*` line, one changelog entry, one tag. Trade-off:
`adapter-xberg` re-publishes even when unchanged; in exchange consumers get
a single version to reason about, and the pack/install proofs cover the
exact matrix that ships. If the Xberg pin ever needs an out-of-band fix,
`adapter-xberg` MAY take a solo patch bump (e.g. `0.9.0-rc.2` for that
package only) — document it in CHANGELOG when it happens.

## 1. Preconditions (all MUST hold)

1. On `main`, clean tree, synced with origin:
   ```bash
   git checkout main && git fetch origin --prune && git pull --ff-only origin main
   git status --short   # empty
   ```
2. CI green on that exact tip (CI workflow + Release Check workflow).
3. No open STOP conditions: no npm name conflict, no unexpected existing
   release, no critical false-verified/exported > 0, no circular package
   deps, no known critical vulnerability in the dependency closure.
4. You hold the **release role** (npm org 2FA + permission to create the
   Trusted Publisher) — see §6.

## 2. Preflight registry checks (read-only)

Machine truth is **not** `npm view`. `pnpm release:registry-verify` reads three
independent registry GETs (exact version, dist-tags, root packument). Human
eyeballing may still use `npm view` as a convenience; it is not the gate.

```bash
for p in schema core temporal adapters extractor verifier exporters consumer adapter-xberg cli; do
  npm view "@actionmanifest/$p" version dist-tags 2>&1 | head -2
done
```

- `0.9.0-rc.0` **exists** on all 10 names. A 404 now means packument lag or
  a registry-read problem — retry bounded reads; do not republish. CLI
  timeout is UNKNOWN, not a publish failure.
- Confirm the npm org `actionmanifest` exists and you can publish into it.
- Confirm no `git tag` / GitHub Release collision: `git tag --list`,
  `gh release list`.

## 3. Verify everything (the only gate)

```bash
pnpm release:check
```

This composes, in order: governance guards → lint → typecheck (incl. the
external reference consumer) → schema validation (frozen checksums) → unit
tests → integration tests → universal conformance (65/65, critical false
exported = 0) → reference serialization (4/4) → benchmark smoke + full (74
fixtures, 40 adversarial, critical false-verified = 0) → `pack:check`
(packs all 10 packages; metadata, tarball contents, standalone consumers
with declared deps only, CLI install smoke from a foreign cwd) → executable
docs examples → `release:dry-run` (release artifacts + SBOM + install
smoke). Any failure aborts the chain. Do not proceed on a yellow chain.

### Verification paths (ops constraint ③)

`pnpm release:check` is the **single entry** for full verification. CI does
not duplicate the whole chain on every PR:

| Path | Trigger | Runs |
| --- | --- | --- |
| Quick | `pull_request` | `pnpm release:check:quick` = `pack:check` + `docs:examples` + `release:dry-run`. All other gates already run in the CI workflow on the same ref. |
| Full | `push` to `main`, tag `v*` (tag / pre-publish verification — runs after the tag push, before publish), `workflow_dispatch` | `pnpm release:check` (the complete chain above) |

### Verification can never publish (ops constraints ①④)

- `release:check` / `release:dry-run` run `pnpm pack` only. They never call
  `npm publish` / `pnpm publish`, never create GitHub Releases, never push
  tags. The future publish workflow is a **separate** gated workflow (§6/§8).
- The dry-run **fails closed** if `NPM_TOKEN` or `NODE_AUTH_TOKEN` are
  present in the environment (the Release Check workflow sets them
  explicitly empty), if argv contains "publish", or if the repo `.npmrc`
  carries registry credentials.
- The dry-run **fails on a dirty git tree in CI** (locally it records
  `git.dirty` in the manifest and warns). The publish path additionally
  hard-requires: clean tree, tag version == all package.json versions
  (tag mismatch aborts), and green CI + Release Check on the exact release
  commit (ungated CI aborts) — see §8.

### Artifacts & evidence (ops constraint ⑤⑧)

Expected artifacts in `release-artifacts/` (gitignored — binaries are never
committed to the repo):

- `tarballs/*.tgz` — the exact 10 artifacts that would be published
- `SHA256SUMS` — sha256 of each tarball
- `release-manifest.json` — versions, hashes, engines, dependency graph,
  computed publish order
- `sbom.cdx.json` — CycloneDX 1.5 SBOM (first-party + full external
  production closure)

In CI they upload as artifact **`release-check-<commit-sha>`** with
retention **14 days (PRs)** / **90 days (main, tags, dispatch)**. The
Release Check workflow serializes runs per ref
(`concurrency: release-check-<ref>`): superseded PR runs cancel;
main/tag/RC runs always complete so release evidence is never interrupted.

**Evidence summary path:** the release evidence for a candidate is the
`release-check-<sha>` CI artifact plus its run URL, referenced from the
release PR. Repository-local evidence directories (`evidence/<ticket>/`)
are completed by **Eng ops** per [PUBLIC-BOUNDARY.md](PUBLIC-BOUNDARY.md) —
agents never write evidence content there. **Meeting Round-2 (locked): the
evidence/completion gate ⑤ must be satisfied BEFORE any merge
recommendation — not after; the PR stays DRAFT until all gates pass.**

## 4. Version selection & inventory

1. Choose the release version (bootstrap: `0.9.0-rc.0`; first OIDC RC: `0.9.0-rc.1`).
2. Set `version` in all 10 public package.json files to the same value
   (lockstep). Internal `workspace:*` ranges are rewritten to that exact
   version at pack time by pnpm — no manual dependency edits.
3. Update `CHANGELOG.md` (move Unreleased/phase notes under the version).
4. Commit as `chore(release): v<version>` on a release branch; open a PR;
   merge only after the full chain is green on the release commit.

## 5. Publish order (computed, not remembered)

`release-artifacts/release-manifest.json → publish_order` is computed from
the real dependency graph every dry-run. Current order:

```
@actionmanifest/schema
→ @actionmanifest/core
→ @actionmanifest/{adapters, consumer, exporters, temporal}      (any order)
→ @actionmanifest/{adapter-xberg, extractor, verifier}           (any order)
→ @actionmanifest/cli
```

If the graph ever gains a cycle, the dry-run **stops** — do not publish
until the cycle is removed. Publish strictly in order so that every
package's dependencies are already on the registry when it is published.

## 6. First-ever publish (bootstrap) — manual, then OIDC-only

> **npm reality (docs.npmjs.com, verified 2026-09): a Trusted Publisher can
> only be configured for a package that ALREADY exists on the registry.** The
> first-ever publish therefore CANNOT use OIDC — it is a one-time,
> maintainer-controlled, 2FA-protected manual bootstrap.

### 6.1 Bootstrap sequence (`0.9.0-rc.0`) — COMPLETE

The sequence below is **historical**. Do not run it again for rc.0.

```
release preparation (this repo, PR-reviewed)
  → pnpm bootstrap:check --publish-ready
      # NO local pack: download release-check-<sha>, verify, plan from those files
  → maintainer reviews the EXACT tarballs
  → manual authenticated bootstrap publish with maintainer 2FA
      npm publish ./release-artifacts/tarballs/<pkg>.tgz \
        --access public --tag next --registry https://registry.npmjs.org/
  → all 10 packages now exist on npm
```

Observed after the fact: `latest` was also set to `0.9.0-rc.0` (npm first-publish
behaviour). **Documented only — do not auto-repair dist-tags.**

Hard rules for the bootstrap:

- **Build once, verify once, stage exactly that artifact** (ADR 0009). The
  canonical artifact set is the exact-head Release Check CI artifact.
  `--publish-ready` does **not** local-pack; it downloads `release-check-<sha>`
  and plans from those files. `--prepare` may pack locally (NON-CANONICAL).
- **Reproducibility is gated**: `pnpm release:reproducibility` (10 packs ×
  10 packages, byte-identical, pnpm 11.23.0 only) runs inside
  `release:check`. Same tree → same bytes → same SHA-256.
- **Publish the exact reviewed tarballs.** Do not re-run `npm publish` from a
  package directory — an approved artifact must never be replaced by a
  locally rebuilt one. `release-artifacts/bootstrap-plan.json` carries the
  exact commands (computed publish order, sha256 per tarball).
- **Prepare vs publish-ready are different gates.** `pnpm bootstrap:check --prepare`
  packs and verifies artifacts and may run on a feature branch; it prints
  `PREPARE OK`. Only `pnpm bootstrap:check --publish-ready` — which
  additionally requires a clean tree, `branch == main`, and
  `HEAD == origin/main` (freshly fetched), plus CI + Release Check SUCCESS
  on the exact commit — may print `READY FOR MANUAL BOOTSTRAP`. The exact
  tarball must come from the reviewed commit, not from uncommitted changes.
- **`--access public`** on every command (scoped first publish).
- **`--tag next`** on every command — the bootstrap MUST NOT touch `latest`.
- **No long-lived token enters CI** — not for the bootstrap, not after. The
  bootstrap is a local, interactively authenticated maintainer operation.
- **Partial failure policy (§10 applies):** do NOT unpublish/overwrite
  published rc.0 packages; fix the cause and publish the remaining rc.0
  packages, or escalate to a human decision (deprecate partial set → next
  RC). Never bump a single package silently.

### 6.2 Trusted Publisher configuration (after bootstrap only)

All 10 packages exist on npm. Preferred, auditable, idempotent path:

```bash
pnpm release:setup --check    # read-only discovery + diff
pnpm release:setup --apply    # explicit; READY last; no package release
```

Expected Trusted Publisher fields (SoT = `PUBLIC_PACKAGE_NAMES`):

| Field | Value |
| --- | --- |
| Organization/user | `hello-ai-company` |
| Repository | `ActionManifest` |
| Workflow filename | `release.yml` (must exist under `.github/workflows/`) |
| Environment | `npm-release` |
| Allowed actions | `npm stage` (stage-only; no direct OIDC `npm publish`) |

All fields are case-sensitive and must match exactly. `release:setup`
invokes exact `npm@11.15.0` (never the host 10.x CLI, never
`npm@latest`). `npm trust github` requires write access and account-level
2FA; `--apply` may prompt (human PoP) and uses official `--yes` with a
~2s pace between packages. Package-level “require 2FA and disallow
tokens” stays `MANUAL_REQUIRED` (not `npm access set mfa=publish`) and
blocks READY unless `--attest-manual-security` loads a valid non-secret
attestation (who/when/packages/npm UI control; never tokens/OTP).
Do not run ad-hoc `npm trust`. The npmjs.com UI is
break-glass. See [RELEASE_TRUSTED_PUBLISHING_SETUP.md](RELEASE_TRUSTED_PUBLISHING_SETUP.md)
and [ADR 0010](adr/0010-release-control-plane.md).

### 6.3 OIDC release workflow (Phase 2.4B — file present, not yet armed)

`.github/workflows/release.yml` is the real workflow: **manual
`workflow_dispatch` only** (`stage` | `verify`). It never runs on tag push.
The `stage` job fails loudly unless `vars.NPM_TRUSTED_PUBLISHING_READY`
is exactly `true`. Set that variable only via `pnpm release:setup --apply`
after prerequisites pass read-back (or the break-glass UI). Never from CI.
npm Trusted Publisher matches the workflow **filename** on the default branch.

Invariants:

- GitHub-hosted runner, environment `npm-release`
- `id-token: write` **only** on the stage job
- Node 24 + npm CLI **11.15.0** (Trusted Publishing minimum is 11.5.1;
  we retain 11.15.0). No pnpm, no package-manager cache, no pack/rebuild
- Consumes `release-check-<sha>` — `npm stage publish <canonical.tgz>`
  in manifest order; prerelease → `--tag next`, stable → `--tag latest`
- No `npm publish`, no `npm stage approve`, no GitHub Release, no tag create
- OIDC only — fails closed if `NPM_TOKEN` / `NODE_AUTH_TOKEN` are present

### 6.4 Status

`0.9.0-rc.0` is on npm (10/10). **No git tag, no GitHub Release.**
Phase 2.4C adds `pnpm release:setup` (check/apply). Do not bump the
version in this phase. Do not treat this documentation PR as a package
release. Remaining human boundary: npm auth/2FA when requested;
`npm stage approve` (2FA) after a later `release.yml` mode=`stage`.

## 7. Tag & publish ordering (unified, tag-triggered)

The release is **not** tag-triggered. A human creates the immutable tag
**after** gates are green; staging is a later `workflow_dispatch`:

1. **Version PR merge** — the lockstep version bump lands on `main`.
2. **Exact-commit CI + Release Check GREEN** — canonical tarballs built
   once on GHA Linux; Node 20 consumer proof + Node 22 Xberg proof run on
   those artifacts.
3. **Create + push the version tag** on that exact commit (never for rc.0;
   rc.0 has no tag).
4. **Manual `workflow_dispatch` `release.yml` mode=stage** — verifies
   tag/HEAD/CI + a successful **FULL** Release Check (not a `pull_request`
   check), downloads that run's `release-check-<sha>`, validates the full
   canonical identity, then `npm stage publish` exact `.tgz` files. Stops.
   Human 2FA approve later.
5. **Manual `workflow_dispatch` mode=verify** — registry byte identity,
   dist-tags, Node 20 registry smoke, Node 22 Xberg registry smoke.
6. **GitHub Release** — only after verify, by a human (not this workflow).

**Tag immutability and failure policy:** once pushed, a tag is never moved
or deleted. If validation or publish fails, **the tag remains** — retry the
workflow on the same tag after fixing the cause, or cut the next RC
(`v0.9.0-rc.2`). A failed publish therefore leaves exactly one git side
effect by design: the immutable tag.

- GitHub Release from the tag (after publish verification, §9): copy the
  CHANGELOG section, attach `SHA256SUMS` and `sbom.cdx.json` from the
  release artifacts.

## 8. Publish (the actual release — separate phase)

Reached only via the §7 ordering (tag-triggered). The publish workflow is
**separate** from Release Check and hard-fails on any of these guards (ops
constraint ④):

- **Dirty tree** — `git status --porcelain` must be empty on the tagged
  commit.
- **Tag mismatch** — the triggering tag `vX.Y.Z` must equal the `version` in
  every public package.json (lockstep); any mismatch aborts before the first
  publish.
- **Ungated CI** — CI and Release Check must both be green on the exact
  tagged commit; the workflow verifies this via the commit status API and
  aborts otherwise.
- **Credentials** — OIDC only (`id-token: write`); the job fails closed if
  `NPM_TOKEN`/`NODE_AUTH_TOKEN` are present. No long-lived tokens exist.

```bash
# In the OIDC stage job — never from a laptop with a long-lived token.
# Exact tarballs from the Release Check artifact (never rebuilt):
npm stage publish ./release-artifacts/tarballs/<file>.tgz \
  --access public --tag <next|latest per prerelease> --registry https://registry.npmjs.org/
```

A human later approves the npm stage (2FA). CI never runs `npm stage approve`
and never runs `npm publish`.

## 9. Post-publish verification (mandatory)

Within minutes of publish. **Always pin the exact version** — bare
`npm view <pkg>` / `npm install <pkg>` resolve the `latest` dist-tag, which
prerelease publishes (`--tag next`) intentionally never touch. Verifying
`latest` after an RC publish verifies nothing.

```bash
V=0.9.0-rc.1   # the version just published (0.9.0-rc.0 for the bootstrap)
R=https://registry.npmjs.org/   # pin the registry — never rely on local npm config
npm view @actionmanifest/cli@$V version --registry $R        # the new version
npm view @actionmanifest/core@$V dist.tarball --registry $R  # resolves
# Registry bytes == reviewed bytes: npm stores SHA-512 SRI in
# dist.integrity, so do NOT compare it to our SHA-256 plan. Download the
# registry tarball and compare sha256 against release-manifest.json /
# bootstrap-plan.json instead:
curl -sSL "$(npm view @actionmanifest/core@$V dist.tarball --registry $R)" -o /tmp/core.tgz
sha256sum /tmp/core.tgz        # Linux — must equal the manifest/plan sha256
# macOS: shasum -a 256 /tmp/core.tgz
# Portable: node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('/tmp/core.tgz')).digest('hex'))"
# Fresh project, real registry. After a LOCAL npm install, PATH does not
# include node_modules/.bin — invoke the bin by path (or via npm exec).
# And ALWAYS name the package explicitly with npx (the unscoped npm name
# "actionman" is an unrelated package):
mkdir /tmp/verify && cd /tmp/verify && npm init -y
npm install @actionmanifest/cli@$V
./node_modules/.bin/actionman --version     # the new version
./node_modules/.bin/actionman conformance   # CONFORMANT 65/65
# Equivalent: npm exec --package=@actionmanifest/cli@$V -- actionman --version
# One-shot form (no install), version pinned because `latest` does not exist
# for RC publishes:
#   npm exec --package=@actionmanifest/cli@$V -- actionman conformance
npm install @actionmanifest/core@$V @actionmanifest/adapters@$V @actionmanifest/extractor@$V \
  @actionmanifest/verifier@$V @actionmanifest/exporters@$V @actionmanifest/consumer@$V
node -e "import('@actionmanifest/core').then(m => console.log('core OK', m.SCHEMA_VERSION))"
```

Also verify provenance attestations are visible on npmjs.com
("provenance" badge) for every package.

## 10. Rollback & partial-publish failure policy

- **Never `npm unpublish`** a release that may have consumers; unpublish is
  only for the first 72 hours AND empty-dependency packages — prefer
  deprecation.
- Bad release → `npm deprecate <pkg>@<version> "reason"` (all 10 packages,
  lockstep), then publish a fixed `rc.N+1`. Document in CHANGELOG.
- **Partial publish** (some packages published, one failed): do NOT retry
  blindly. Published packages of the same lockstep version with missing
  siblings are a broken line. Either (a) fix the cause and publish the
  remaining packages of the SAME version immediately, or (b) deprecate the
  partial set and cut the next RC. Record the decision in the release issue.
- **Failed publish and git state:** the version tag was pushed before the
  publish ran (tag-triggered, §7) and is never moved or deleted. Retry the
  workflow on the same tag, or cut the next RC tag.

## 11. What Phase 2.4C deliberately does NOT do

- No version bump off `0.9.0-rc.0`. No `rc.1`. No merge of this PR by the agent.
- No package release: no `npm publish`, no `npm stage publish`, no
  `npm stage approve`, no dist-tag / unpublish / deprecate.
- No git tag. No GitHub Release.
- `pnpm release:setup --check` is read-only. `--apply` writes only approved
  control-plane settings (Environment, managed tag ruleset, Trusted
  Publishers, READY last) when explicitly invoked — not as part of tests
  or `release:check`.
- Direct OIDC `npm publish` is never enabled.
- `pnpm release:check` / `pnpm release:dry-run` remain verification-only.
