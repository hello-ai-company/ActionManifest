# Bootstrap Release Checklist — 0.9.0-rc.0

The first-ever publish of `@actionmanifest/*`. **Manual, maintainer-only,
2FA-protected.** Agents prepare and verify; they never publish.

## Why a manual bootstrap

npm Trusted Publishing can only be attached to a package that **already
exists** on the registry (docs.npmjs.com, verified 2026-09). The first
publish therefore cannot use OIDC. `0.9.0-rc.0` creates the package
identities safely; `0.9.0-rc.1+` ships via OIDC only.

## Pre-flight (agent-verified, this PR)

- [x] main base verified (Phase 2.3 merge `65a9e8e`, post-merge CI + Release Check GREEN)
- [x] All 10 package versions == `0.9.0-rc.0` (lockstep; version gate in `bootstrap:check`)
- [x] 10 exact tarballs built and verified (`pnpm release:dry-run`)
- [x] `SHA256SUMS` + `release-manifest.json` + `sbom.cdx.json` (CycloneDX 1.5 schema-valid)
- [x] pack / install / CLI smoke PASS (`pack:check`, `cli-install-smoke`)
- [x] Universal conformance 65/65, reference serialization 4/4
- [x] Benchmark 74 fixtures / 40 adversarial, critical false-verified = 0, critical false-exported = 0
- [x] Registry preflight: all 10 `@actionmanifest/*` names return 404
- [x] Frozen schemas untouched; conformance suite 0.2.0 unchanged
- [x] No npm credentials in repo/CI (`.npmrc` clean; workflows pin tokens empty)
- [x] `bootstrap-plan.json` generated (exact tarballs, sha256, publish order)

## Manual prerequisites (maintainer)

- [ ] npm org/scope `actionmanifest` exists and you hold publish rights (owner). Agents never create it.
- [ ] Maintainer account has 2FA enabled (required for publish and for `npm trust`).
- [ ] You reviewed the exact tarballs listed in `release-artifacts/bootstrap-plan.json`.

## Manual bootstrap publish (maintainer ONLY)

Run from the repo root, in the plan's computed order, using the EXACT
tarballs (never re-pack):

```bash
pnpm bootstrap:check   # regenerate + verify the plan (read-only registry preflight)
# then, per package, in order:
npm publish ./release-artifacts/tarballs/<file>.tgz --access public --tag next
```

- [ ] All 10 commands executed in `publish_order`
- [ ] Every command used `--access public` and `--tag next`
- [ ] `latest` dist-tag untouched (`npm view <pkg> dist-tags` shows only `next`)

## Post-publish verification (maintainer)

For each of the 10 packages:

- [ ] `npm view <pkg> version` → `0.9.0-rc.0`
- [ ] `npm view <pkg> dist.tarball` resolves
- [ ] `npm view <pkg> dist.integrity` matches the plan's sha256 lineage
- [ ] Fresh directory `npm install <pkg>` works
- [ ] `npm install @actionmanifest/cli` → `actionman --version` → `0.9.0-rc.0`, `actionman conformance` → CONFORMANT

## Trusted Publisher configuration (after ALL 10 exist)

Per package, on npmjs.com (or `npm trust github`, npm CLI ≥ 11.15, 2FA):

- [ ] Organization/user: `hello-ai-company`
- [ ] Repository: `ActionManifest`
- [ ] Workflow filename: `release.yml`
- [ ] Environment: `release`
- [ ] Allowed actions: `npm publish`
- [ ] Direct token publishing restricted (org/package settings)

## Then (Phase 2.4B)

- [ ] Enable `.github/workflows/release.yml` from `release.yml.template`
- [ ] Bump `0.9.0-rc.1`, tag `v0.9.0-rc.1`, OIDC release via GitHub Actions

## Partial bootstrap failure policy

If a publish fails mid-way: do NOT unpublish, overwrite, or silently bump a
single package. Fix the cause and publish the remaining rc.0 packages at the
same version; if impossible, escalate to a human decision (deprecate the
partial set → cut the next RC). See RELEASING.md §10.
