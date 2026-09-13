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

## 0. Two-layer verification (read-only)

Phase 2.4D splits verification. Safety is not weakened: Agent Check never
treats `READY=true` or a manual attestation file as live npm proof.

| Layer | Command | What it does |
| --- | --- | --- |
| **Normal (Agent / CI)** | `pnpm release:setup --check-agent` | GitHub + local desired config + cached READY/fingerprint. **No** `npm trust list`, package-security queries, npm login/2FA, or writes. |
| **Governance audit** | `pnpm release:setup --audit-live` | Full live read-back including npm trust list / security / auth detection. Without human npm auth → `BLOCKED — NPM HUMAN AUTH REQUIRED` is OK. After a fully successful live audit it may persist `NPM_TRUSTED_PUBLISHING_CONFIG_SHA256` (never READY). |
| **Backward compatible** | `pnpm release:setup --check` | Same live path as `--audit-live`. **Not** silently changed into agent-only. |
| **Mutation** | `pnpm release:setup --apply` | Explicit converge only, after a brief authorizes it. READY last. |

```bash
pnpm release:setup --check-agent
pnpm release:setup --audit-live
pnpm release:setup --check
```

`--check` and `--check-agent` are read-only (zero mutations). `--audit-live`
does not flip READY and does not write Environment / ruleset / npm; the
only allowed write is persisting the live-approved config SHA after a
fully successful live audit.

### 0.1 Agent Check (`--check-agent`)

Verifies: repo identity, `release.yml` + `environment: npm-release`,
Environment existence + deployment-branch policy, tag ruleset
`actionmanifest-release-tags` (PR#13 tag read-back: GitHub REST may omit
`update.parameters`; that is MATCH for tag-target), READY variable,
in-repo release / desired control-plane config, and
`CONTROL_PLANE_CONFIG_SHA256` (`docs/evidence/control-plane-config-fingerprint.json`).
The fingerprint includes the deterministic SHA-256 of the entire
`.github/workflows/release.yml` file (UTF-8). Editing that file invalidates
`CACHED_OK` / Agent Check `PASS` (`WORKFLOW_CHANGED` → live audit).
No secrets or timestamps enter the fingerprint.

Environment secrets follow Phase 2.4C fail-closed: GET 401/403 →
`AUTH_REQUIRED`; other read failures → `UNKNOWN`. Agent Check must not
`PASS` while secrets discovery is `AUTH_REQUIRED` / `UNKNOWN`. A successful
empty secrets list is OK (no `NPM_TOKEN` / `NODE_AUTH_TOKEN` names).

`READY=true` alone is **not** enough. The committed fingerprint is not the
approval record. Verdict `PASS` only when **all** of these hold:

1. READY is exactly `true`
2. GitHub Actions variable `NPM_TRUSTED_PUBLISHING_CONFIG_SHA256` (outside
   the repo) equals the computed `CONTROL_PLANE_CONFIG_SHA256`
3. committed fingerprint integrity is OK (current == committed snapshot)
4. GitHub control plane OK (env / ruleset / workflow)

A same-PR edit that changes `release.yml` and updates the committed
fingerprint cannot `PASS` while the live-approved hash is still the old
value. Missing / unreadable / mismatch approved hash →
`LIVE AUDIT REQUIRED` (never `PASS`). Check paths never invent or write
that variable.

Fail-closed:

- READY missing/false → `LIVE AUDIT REQUIRED`
- package set change → `LIVE AUDIT REQUIRED — PACKAGE SET CHANGED`
- publisher config change → `LIVE AUDIT REQUIRED — PUBLISHER CONFIG CHANGED`
- material workflow change → `LIVE AUDIT REQUIRED`
- fingerprint mismatch → `LIVE AUDIT REQUIRED — CONFIG DRIFT`
- GitHub drift (missing env/ruleset, wrong workflow) → `BLOCKED`

Normal success: `verdict=PASS`; GitHub rows `NOOP`;
`NPM LIVE GOVERNANCE: NOT QUERIED`; writes=0; no Human action required.
The attestation file may be hashed into the fingerprint; it is **never**
live npm security proof.

### 0.2 Live audit (`--audit-live` / `--check`)

Inspects everything Agent Check does, plus npm live governance:

1. GitHub Environment `npm-release` (exists; deployment branch `main`;
   required reviewers **optional** — npm staged approval + 2FA is the
   mandatory human gate). `release.yml` must keep `environment: npm-release`.
2. Tag ruleset managed name `actionmanifest-release-tags`, pattern `v*`
   (protect unauthorized delete/update). Unrelated rulesets are left alone.
   GitHub REST read-back may omit `update.parameters`; that is MATCH for
   tag-target (the `update` rule must still exist). Create/update writes
   still send `update_allows_fetch_and_merge: false`. Branch-target
   assessment, if used later, stays strict on that parameter.
3. Repository variables `NPM_TRUSTED_PUBLISHING_READY` and
   `NPM_TRUSTED_PUBLISHING_CONFIG_SHA256`. `--check` is read-only.
   `--audit-live` may persist the approved config SHA after a successful
   live audit; it never flips READY. `READY=true` with incomplete **live**
   prerequisites is **CRITICAL**.
4. npm Trusted Publishers for all 10 names in `PUBLIC_PACKAGE_NAMES`
   (SoT — do not duplicate the roster): GitHub Actions,
   `hello-ai-company/ActionManifest`, workflow `release.yml`, environment
   `npm-release`, **stage publish only**. Direct OIDC `npm publish` must
   not be enabled.
5. Package security (2FA required, long-lived publish tokens disallowed,
   Trusted Publishing used). If not safely readable via the official CLI
   the status is `MANUAL_REQUIRED` / `UNSUPPORTED` / `UNKNOWN` — never a
   fake `PASS`.

Live verdict: `READY` / `NOT_READY` / `BLOCKED`. Optional local
`release-control-plane-report.json` (gitignored, non-secret).

## 1. Converge (explicit apply)

```bash
pnpm release:setup --apply
```

Prints the plan, then writes **only** approved control-plane settings, in
order: Environment → tag ruleset → Trusted Publishers 10/10 → automatable
security → read-back → persist `NPM_TRUSTED_PUBLISHING_CONFIG_SHA256` →
**only then** `NPM_TRUSTED_PUBLISHING_READY=true` → final read-back.
Idempotent: a second apply reports `NO CHANGES REQUIRED`.

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
to that Settings control (re-checked: no official CLI sets the
“disallow tokens” radio). Status is `MANUAL_REQUIRED` and **blocks READY**
by default.

To converge READY after a maintainer has verified the npm UI control,
pass an explicit attestation (not a silent PASS, never tokens/OTP):

```bash
pnpm release:setup --check --attest-manual-security
pnpm release:setup --apply --attest-manual-security[=<path>]
```

Default path: `docs/evidence/manual-package-security-attestation.json`.
Copy `docs/evidence/manual-package-security-attestation.example.json`
and fill who / when / which packages / what was verified in npm Settings
(“Require two-factor authentication and disallow tokens”). Optional local
`release-manual-security-attestation.json` is gitignored. The example
placeholders fail validation on purpose. Status stays `MANUAL_REQUIRED`
(not rewritten to `OK`). Invalid or missing attestation still blocks.
`READY=true` + `MANUAL_REQUIRED` without a valid attestation is CRITICAL.

Every `release:setup` npm path asserts the live binary prints
`11.15.0` before `trust` / `access` (never host npm, never `npm@latest`).

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

## 3. Repository variables (approved hash, then READY last)

`pnpm release:setup --apply` persists
`NPM_TRUSTED_PUBLISHING_CONFIG_SHA256` (computed fingerprint) after
read-back, then sets `NPM_TRUSTED_PUBLISHING_READY=true`. `--audit-live`
may persist the approved hash only; it never flips READY. Break-glass:

- [ ] Settings → Secrets and variables → Actions → Variables
      `NPM_TRUSTED_PUBLISHING_CONFIG_SHA256` = live-approved fingerprint SHA
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
