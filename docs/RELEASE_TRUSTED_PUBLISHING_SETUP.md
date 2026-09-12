# Trusted Publishing setup

Preferred controller: **`pnpm release:setup`**. The GitHub / npmjs.com UI is
**break-glass** only (use it when the official CLI/API cannot express a
setting). CI workflows still must not set repository variables.

`0.9.0-rc.0` already exists on npm (10/10). `.github/workflows/release.yml`
is on `main` (Phase 2.4B). Trusted Publishers match that **filename**
exactly. This phase does **not** bump off `0.9.0-rc.0`.

Human proof-of-presence is **not** automated: npm login / account 2FA /
WebAuthn / security key / OTP when the official CLI requests it, and later
`npm stage approve` (2FA). `release:setup` never runs `npm publish`,
`npm stage publish`, or `npm stage approve`.

## 0. Audit (read-only)

```bash
pnpm release:setup --check
```

Completely read-only. Zero mutations. Inspects:

1. GitHub Environment `npm-release` (exists; deployment branch `main`;
   required reviewers **optional** — npm staged approval + 2FA is the
   mandatory human gate). `release.yml` must keep `environment: npm-release`.
2. Tag ruleset managed name `actionmanifest-release-tags`, pattern `v*`
   (protect unauthorized delete/update). Unrelated rulesets are left alone.
3. Repository variable `NPM_TRUSTED_PUBLISHING_READY` (read only here).
   `READY=true` with incomplete prerequisites is **CRITICAL**.
4. npm Trusted Publishers for all 10 names in `PUBLIC_PACKAGE_NAMES`
   (SoT — do not duplicate the roster): GitHub Actions,
   `hello-ai-company/ActionManifest`, workflow `release.yml`, environment
   `npm-release`, **stage publish only**. Direct OIDC `npm publish` must
   not be enabled.
5. Package security (2FA required, long-lived publish tokens disallowed,
   Trusted Publishing used). If not safely readable via the official CLI
   the status is `MANUAL_REQUIRED` / `UNSUPPORTED` / `UNKNOWN` — never a
   fake `PASS`.

Verdict: `READY` / `NOT_READY` / `BLOCKED`. Optional local
`release-control-plane-report.json` (gitignored, non-secret).

## 1. Converge (explicit apply)

```bash
pnpm release:setup --apply
```

Prints the plan, then writes **only** approved control-plane settings, in
order: Environment → tag ruleset → Trusted Publishers 10/10 → automatable
security → read-back → **only then** `NPM_TRUSTED_PUBLISHING_READY=true` →
final read-back. Idempotent: a second apply reports `NO CHANGES REQUIRED`.

Require `gh` auth against **`hello-ai-company/ActionManifest`**.
`release:setup` uses the **exact pinned npm CLI 11.15.0**
(`PINNED_NPM_CLI`), not the host global (a host `npm` 10.x must not
decide Trusted Publisher discovery). The runner prefers
`.release-tools/npm-cli/11.15.0` or `node_modules/npm@11.15.0`, else
`npx --yes --package=npm@11.15.0` (this may download that exact version
into the npx cache; it never installs `npm@latest` and never replaces
the global CLI). Interactive maintainer auth is allowed when npm
prompts. Bulk Trusted Publisher creates pass official `--yes` and wait
~2s between packages so one 2FA session can cover the roster. Drifted
Trusted Publishers (wrong repo/workflow/env) **STOP** — no overwrite.

Package security “require 2FA and disallow tokens” is **not** automated:
official `npm access set mfa=publish` is **not** documented as equivalent
to that Settings control. Status is `MANUAL_REQUIRED` and **blocks READY**.

## 2. Break-glass UI (only if `--apply` cannot)

### GitHub Environment `npm-release`

Settings → Environments:

- [ ] Name exactly `npm-release`
- [ ] Deployment branches: `main` (restrict)
- [ ] Required reviewers: optional
- [ ] No `NPM_TOKEN` / `NODE_AUTH_TOKEN` secrets

### npm Trusted Publisher (stage-only) — all 10 packages

On npmjs.com (or official `npm trust github`, CLI ≥ 11.15, account 2FA):

| Field | Value |
| --- | --- |
| Organization/user | `hello-ai-company` |
| Repository | `ActionManifest` |
| Workflow filename | `release.yml` |
| Environment | `npm-release` |
| Allowed actions | **`npm stage` only** (do not enable live `npm publish`) |

Packages come from `PUBLIC_PACKAGE_NAMES` (`@actionmanifest/schema`, `core`,
`temporal`, `adapters`, `extractor`, `verifier`, `exporters`, `consumer`,
`adapter-xberg`, `cli`). All fields are case-sensitive.

Do not run ad-hoc `npm trust` except via `pnpm release:setup --apply` or this
break-glass path.

### 2FA and token policy

- [ ] Maintainer account 2FA enabled (required for `npm stage approve`)
- [ ] Granular / classic automation tokens **disallowed** for publish
      (package Settings → require 2FA and disallow tokens) when the CLI
      cannot set this — `MANUAL_REQUIRED`
- [ ] CI has no `NPM_TOKEN` / `NODE_AUTH_TOKEN` secrets
- [ ] The release workflow already fails closed if those env vars are non-empty

### Tag protection

- [ ] Ruleset `actionmanifest-release-tags` on `v*` (immutable; no force-push, no delete)
- [ ] Only the release role may create version tags
- [ ] Tags are created **by a human after** main CI + Release Check are green
      on the exact SHA — never by `release.yml`

## 3. Repository variable (last)

`pnpm release:setup --apply` sets `NPM_TRUSTED_PUBLISHING_READY=true`
**only after** prerequisites pass read-back. Break-glass:

- [ ] Settings → Secrets and variables → Actions → Variables
      `NPM_TRUSTED_PUBLISHING_READY` = `true`

Until that variable is exactly `true`, `release.yml` mode=`stage` **fails
loudly**. Do not set it from a workflow. Do not set it if Trusted
Publishers / Environment / tag ruleset are incomplete.

## 4. What CI still will not do

After setup, `workflow_dispatch` mode=`stage` will:

1. Re-check the variable, tag/HEAD/CI/Release Check
2. Download `release-check-<sha>`
3. `npm stage publish <canonical.tgz> --tag next|latest`
4. Stop

A **human** later runs `npm stage approve` (2FA) out of band. Then someone
dispatches mode=`verify`. GitHub Release is a later, separate human step —
not this workflow and not `release:setup`.
