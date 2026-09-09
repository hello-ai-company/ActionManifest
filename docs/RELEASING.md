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
| npm **package version** (all 10 packages, lockstep) | `0.1.0` → next: **`0.9.0-rc.1`** | any code/packaging change |
| Manifest **schema version** | `0.1.0`, `0.2.0` (frozen) | never in a release — new schema = new versioned directory, separate governance |
| **Conformance suite version** | `0.2.0` | normative vector/meta-schema changes (governance-enforced) |

A release NEVER changes a frozen schema or normative conformance contents.
If a release seems to require one, **STOP** — that is a schema/suite phase,
not a release.

### Recommended first public version: `0.9.0-rc.1`

Rationale (ADR 0007): the contract is conformance-gated and stable enough to
publish, but pre-1.0 signals "no stability promise beyond the conformance
suite". `0.9.0-rc.1` leaves room for further RCs (`0.9.0-rc.2`, …) and a
`0.9.0` / `1.0.0` graduation without rewriting history. All 10 packages
share one version (**lockstep / fixed versioning**) — one coherent
`@actionmanifest/*` line, one changelog entry, one tag. Trade-off:
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

```bash
for p in schema core temporal adapters extractor verifier exporters consumer adapter-xberg cli; do
  npm view "@actionmanifest/$p" version dist-tags 2>&1 | head -2
done
```

- Expect `404` for all before the first release. Anything else → investigate
  (a pre-existing package under our scope means a registry account issue;
  a third-party-owned scope would be a **BLOCKER** — do not rename the scope
  unilaterally; escalate).
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

Expected artifacts in `release-artifacts/` (gitignored; also uploaded by the
Release Check workflow with 7-day retention):

- `tarballs/*.tgz` — the exact 10 artifacts that would be published
- `SHA256SUMS` — sha256 of each tarball
- `release-manifest.json` — versions, hashes, engines, dependency graph,
  computed publish order
- `sbom.cdx.json` — CycloneDX 1.5 SBOM (first-party + full external
  production closure)

## 4. Version selection & inventory

1. Choose the release version (first release: `0.9.0-rc.1`).
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

## 6. Trusted Publishing (OIDC) — the only supported path

Long-lived npm tokens are **not used**. Before the first publish:

1. npm: create the `actionmanifest` org (or confirm access) with 2FA
   enforced.
2. Configure **Trusted Publishing** for each package on npmjs.com:
   repository `hello-ai-company/ActionManifest`, workflow
   `release.yml`, environment `release`.
3. The future `.github/workflows/release.yml` (NOT yet enabled) will:
   - trigger on the version tag only,
   - hold `permissions: { id-token: write, contents: read }` — OIDC, no
     `NODE_AUTH_TOKEN`,
   - run `pnpm release:check` first,
   - publish with `pnpm publish --provenance --access public` (npm CLI
     11.5.1+ for trusted publishing),
   - never run lifecycle scripts from the registry during verification
     (`--ignore-scripts` on consumer-side checks).
4. `.npmrc` in the repo must never contain tokens (the dry-run fails if it
   does).

## 7. Tag & GitHub Release strategy

- One tag per release: `v0.9.0-rc.1` on the exact release commit (after the
  version-bump PR merges). Lockstep versions mean one tag covers all
  packages.
- GitHub Release from that tag: copy the CHANGELOG section, attach
  `SHA256SUMS` and `sbom.cdx.json` from the dry-run artifacts.
- Tags are immutable: never move or delete a published tag.

## 8. Publish (the actual release — separate phase)

Only after §1–§7 are satisfied and the release PR is merged:

```bash
# In the OIDC release workflow — never from a laptop with a long-lived token.
pnpm -r --filter "./packages/*" --filter "./apps/*" publish --provenance --access public --no-git-checks
```

(publish in the §5 order; with lockstep versions a topological
`pnpm -r publish` satisfies it, but verify against the manifest.)

## 9. Post-publish verification (mandatory)

Within minutes of publish:

```bash
npm view @actionmanifest/cli version        # the new version
npm view @actionmanifest/core dist.tarball  # resolves
# Fresh project, real registry:
mkdir /tmp/verify && cd /tmp/verify && npm init -y
npm install @actionmanifest/cli
npx actionman --version                     # new version
npx actionman conformance                   # CONFORMANT 65/65
npm install @actionmanifest/core @actionmanifest/adapters @actionmanifest/extractor \
  @actionmanifest/verifier @actionmanifest/exporters @actionmanifest/consumer
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
- A failed publish leaves no git side effects: the tag is created only after
  a fully verified publish.

## 11. What this phase deliberately does NOT do

- No `npm publish` / `pnpm publish` has been run. No tags, no GitHub
  Releases. The live OIDC workflow is specified but intentionally not
  enabled. `pnpm release:dry-run` proves everything short of the registry
  write.
