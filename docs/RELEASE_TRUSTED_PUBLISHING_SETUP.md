# Trusted Publishing setup (human checklist)

This is a **maintainer** checklist. Agents and CI must not set repository
variables, create the GitHub Environment, or run `npm trust`.

`0.9.0-rc.0` already exists on npm (10/10). Trusted Publishers can now be
attached. They **cannot** be configured until `.github/workflows/release.yml`
is on the default branch — npm matches the workflow **filename** exactly.

## 0. Merge `release.yml` first

1. Merge the Phase 2.4B PR so `.github/workflows/release.yml` exists on `main`.
2. Confirm the file is named exactly `release.yml` (not `.template`).
3. Only then open npm Trusted Publisher settings. Configuring them against a
   filename that is not on `main` will fail every OIDC exchange.

## 1. GitHub Environment `npm-release`

In the GitHub repo **Settings → Environments**:

- [ ] Create environment named exactly `npm-release`
- [ ] Required reviewers: at least one release-role maintainer
- [ ] Deployment branches: `main` only (restrict)
- [ ] No `NPM_TOKEN` / `NODE_AUTH_TOKEN` secrets on this environment (or anywhere)

The workflow’s `stage` job sets `environment: npm-release`. Approval of that
environment is **not** a substitute for npm’s 2FA stage approve.

## 2. npm Trusted Publisher (stage-only) — all 10 packages

For each package, on npmjs.com (or `npm trust github`, CLI ≥ 11.15, account 2FA):

| Field | Value |
| --- | --- |
| Organization/user | `hello-ai-company` |
| Repository | `ActionManifest` |
| Workflow filename | `release.yml` |
| Environment | `npm-release` |
| Allowed actions | **`npm stage` only** (do not allow live `npm publish` if the UI lets you restrict) |

Packages (all must be configured):

- `@actionmanifest/schema`
- `@actionmanifest/core`
- `@actionmanifest/temporal`
- `@actionmanifest/adapters`
- `@actionmanifest/extractor`
- `@actionmanifest/verifier`
- `@actionmanifest/exporters`
- `@actionmanifest/consumer`
- `@actionmanifest/adapter-xberg`
- `@actionmanifest/cli`

All fields are case-sensitive. Agents never run `npm trust`.

## 3. 2FA and token policy

- [ ] Maintainer account 2FA enabled (required for `npm stage approve`)
- [ ] Granular / classic automation tokens **disallowed** for publish
      (org or package setting: require Trusted Publisher / 2FA, no
      `NPM_TOKEN` publish)
- [ ] Confirm CI has no `NPM_TOKEN` / `NODE_AUTH_TOKEN` secrets
- [ ] The release workflow already fails closed if those env vars are non-empty

## 4. Tag protection

- [ ] Protect `v*` tags (immutable; no force-push, no delete)
- [ ] Only the release role may create version tags
- [ ] Tags are created **by a human after** main CI + Release Check are green
      on the exact SHA — never by this workflow

## 5. Repository variable (last)

Only after steps 1–4 are done:

- [ ] Set Actions variable `NPM_TRUSTED_PUBLISHING_READY` = `true`
      (Settings → Secrets and variables → Actions → Variables)

Until that variable is exactly `true`, `release.yml` mode=`stage` **fails
loudly**. Do not set it from a workflow. Do not set it in this PR.

## 6. What CI still will not do

After setup, `workflow_dispatch` mode=`stage` will:

1. Re-check the variable, tag/HEAD/CI/Release Check
2. Download `release-check-<sha>`
3. `npm stage publish <canonical.tgz> --tag next|latest`
4. Stop

A **human** later runs `npm stage approve` (2FA) out of band. Then someone
dispatches mode=`verify`. GitHub Release is a later, separate human step —
not this workflow.
