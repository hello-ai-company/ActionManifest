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
tarballs (never re-pack). The pre-publish gate MUST be the strict mode —
plain `bootstrap:check` (prepare) is not sufficient for an irreversible
registry write:

```bash
pnpm bootstrap:check --publish-ready
# ↑ fetches fresh origin/main, requires clean tree + main + HEAD == origin/main,
#   and verifies CI + Release Check are SUCCESS on the exact HEAD.
# then, per package, in order (commands copied from bootstrap-plan.json):
npm publish ./release-artifacts/tarballs/<file>.tgz \
  --access public \
  --tag next \
  --registry https://registry.npmjs.org/
```

- [ ] `pnpm bootstrap:check --publish-ready` printed `READY FOR MANUAL BOOTSTRAP`
- [ ] All 10 commands executed in `publish_order`
- [ ] Every command used `--access public`, `--tag next`, AND `--registry https://registry.npmjs.org/`
- [ ] `latest` dist-tag untouched (`npm view <pkg> dist-tags --registry https://registry.npmjs.org/` shows only `next`)

## Post-publish verification (maintainer)

The bootstrap publishes to dist-tag `next` only — `latest` does not exist
yet. Bare `npm view <pkg>` / `npm install <pkg>` default to `latest`, so
every verification MUST pin the exact version.

Every command pins the registry — never rely on local npm config. Set the
variables first:

```bash
V=0.9.0-rc.0
R=https://registry.npmjs.org/
```

For each of the 10 packages:

- [ ] `npm view <pkg>@0.9.0-rc.0 version --registry $R` → `0.9.0-rc.0`
- [ ] `npm view <pkg>@0.9.0-rc.0 dist.tarball --registry $R` resolves
- [ ] **Registry bytes == reviewed bytes**: download the registry tarball and
      compare sha256 against `bootstrap-plan.json` (do NOT compare against
      `dist.integrity` — npm stores SHA-512 SRI there, not our SHA-256):
      ```bash
      curl -sSL "$(npm view <pkg>@0.9.0-rc.0 dist.tarball --registry $R)" -o /tmp/<pkg>.tgz
      # Linux: sha256sum /tmp/<pkg>.tgz
      # macOS: shasum -a 256 /tmp/<pkg>.tgz
      # Portable: node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('/tmp/<pkg>.tgz')).digest('hex'))"
      # → must equal the plan's sha256
      ```
- [ ] Fresh directory `npm install <pkg>@0.9.0-rc.0 --registry $R` works
- [ ] `npm install @actionmanifest/cli@0.9.0-rc.0 --registry $R` → `actionman --version` → `0.9.0-rc.0`, `actionman conformance` → CONFORMANT
- [ ] `npm view <pkg> dist-tags --registry $R` shows `next` only (no `latest`)

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
