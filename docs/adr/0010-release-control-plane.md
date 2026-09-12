# ADR 0010 — Release Control Plane

Status: Accepted
Date: 2026-09-12
Builds on: ADR 0007 (release versioning), ADR 0008 (bootstrap), ADR 0009 (canonical artifact)
Ticket: ENG-20260912-002 / CASE PA-20260912-003

## Context

Phase 2.4B landed `.github/workflows/release.yml` as a manual `workflow_dispatch`
`stage` | `verify` workflow. Staging still fail-closes unless the repository
variable `NPM_TRUSTED_PUBLISHING_READY` is exactly `true`. Configuring the
GitHub Environment, tag ruleset, npm Trusted Publishers (10/10), and that
variable was a human checklist (`docs/RELEASE_TRUSTED_PUBLISHING_SETUP.md`).

Ad-hoc UI clicks and one-off `gh` / `npm trust` commands are not auditable,
not idempotent, and easy to point at the wrong repo, workflow, or permission
(`--allow-publish` = direct OIDC publish). AGENTS.md is default-deny: release
infrastructure must not be mutated unless a brief explicitly authorizes a
**release-control-plane**.

## Decision

### 1. Default deny

`pnpm release:setup` is the only in-repo controller. Discovery is read-only
until a human (or an explicitly authorized agent brief) passes `--apply`.
No `--apply` means `--check`. Check mode wraps every write method so it
throws. CI workflows do not set `NPM_TRUSTED_PUBLISHING_READY`.

### 2. `--check` / `--apply`

- `--check`: complete read-only discovery + expected-state diff + verdict
  (`READY` / `NOT_READY` / `BLOCKED`). Zero mutations.
- `--apply`: print the plan, then write **only** approved control-plane
  settings, in order, then read-back. Idempotent: a second apply against a
  converged plane reports `NO CHANGES REQUIRED`.

### 3. Idempotent merge/preserve

Unrelated GitHub Environments and rulesets are never deleted or rewritten.
The managed tag ruleset is named exactly `actionmanifest-release-tags`.
Same name + different config → exact diff and update that object only.
Multiple same-name rulesets → `STOP`. Trusted Publisher identity drift
(different org/repo/workflow/env, or direct `npm publish` enabled) →
`DRIFTED` / `SECURITY REVIEW REQUIRED` / `STOP` — no overwrite, no revoke.

### 4. READY last

Order: Environment `npm-release` → tag ruleset → Trusted Publishers 10/10
→ automatable security → read-back → **only then**
`NPM_TRUSTED_PUBLISHING_READY=true` → final read-back.

`READY=true` with incomplete prerequisites is `CRITICAL` (fail loudly).
The controller does **not** auto-flip `READY=false`; drift is detected and
blocks.

### 5. No secrets in outputs

Logs, plans, and `release-control-plane-report.json` never contain
`Authorization`, `Bearer`, `NPM_TOKEN`, `NODE_AUTH_TOKEN`, OTP, or cookies.
`NPM_TOKEN` / `NODE_AUTH_TOKEN` in the process environment fail closed.
The optional report is gitignored and non-secret.

### 6. Official API only — no scraping

GitHub: `gh api` REST only, after `gh` auth + repository identity
`hello-ai-company/ActionManifest` (fail closed on any other repo).
npm: official CLI only, via the **exact pinned runner** `npm@11.15.0`
(`PINNED_NPM_CLI` / `PINNED_NPM_PACKAGE_SPEC`). Host `npm` (often 10.x)
does not determine correctness. Resolution is project-local
(`.release-tools/npm-cli/11.15.0` or `node_modules/npm` at that exact
version) or `npx --yes --package=npm@11.15.0` (documented download into
the npx cache). Never `npm@latest`. Never a silent global replace.
Never HTML scraping.

Package security (2FA required + long-lived tokens disallowed + Trusted
Publishing used) is a READY prerequisite. Only status `OK` satisfies.
`MANUAL_REQUIRED` and `UNSUPPORTED` are **not** PASS and **block READY**.
`npm access set mfa=publish` is the official CLI for package-level
publish 2FA (`mfa=none|publish|automation`). Official npm docs do **not**
equate that write with Settings → Publishing access “Require two-factor
authentication and disallow tokens” (which additionally blocks granular
tokens regardless of bypass-2FA). Therefore that control stays
`MANUAL_REQUIRED` and is not automated.

### 7. Staged publishing only

Trusted Publisher expected state (SoT = `PUBLIC_PACKAGE_NAMES`, not a
second hardcoded roster):

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Org / repo | `hello-ai-company` / `ActionManifest` |
| Workflow | `release.yml` |
| Environment | `npm-release` |
| Allowed operation | `npm stage publish` only (`--allow-stage-publish`) |
| Direct OIDC publish | **not** enabled (no `--allow-publish`) |

`release.yml` must keep `environment: npm-release` on the stage job
(Phase 2.4B contract). This controller does not run `npm publish`,
`npm stage publish`, or `npm stage approve`.

### 8. Human 2FA proof-of-presence is not automated

Account 2FA, WebAuthn, security keys, and OTP completion stay with the
maintainer. The CLI may inherit stdio so the official npm client can prompt.
The controller never passes `--otp`, never stores OTP, never simulates
`npm stage approve`.

### 9. GitHub required reviewers are optional

Environment protection is expected (deployment branch `main`). Required
reviewers are **optional**. npm staged approval + 2FA is the mandatory
human gate. Existing reviewers are preserved; they are not required to
converge.

### 10. No direct / stable publish from this plane

No `npm publish`, no dist-tag mutation, no unpublish, no deprecate, no git
tag, no `gh release create`, no version bump. Package versions stay
`0.9.0-rc.0` until a later, separately authorized release.

## Consequences

- `pnpm release:setup --check` is the preferred audit. The npmjs.com /
  GitHub Settings UI is break-glass only.
- `pnpm release:setup --apply` is the preferred converge path when a brief
  authorizes it. This Phase 2.4C change implements the controller; it does
  not execute a production apply unless evidence lists that run.
- Remaining human boundary after a green plane: npm auth/2FA when the
  official CLI requests it, and later `npm stage approve` (2FA).
- Package-level “require 2FA and disallow tokens” is `MANUAL_REQUIRED` when
  it is not a safely documented official CLI write — never a fake `PASS`.
  `MANUAL_REQUIRED` / `UNSUPPORTED` block `NPM_TRUSTED_PUBLISHING_READY`.
- Managed tag ruleset create/update bodies are explicit GitHub REST rule
  objects. `update` always includes
  `parameters.update_allows_fetch_and_merge: false`. Compatible stronger
  extra rules are preserved; weakening is refused; ambiguous rules STOP.
- Environment updates merge/preserve `wait_timer`, required reviewers,
  `prevent_self_review`, and existing custom branch policies. Secret or
  deployment-branch-policy read failures are fail-closed (`AUTH_REQUIRED` /
  `UNKNOWN`) — never treated as empty-OK. When only `main` is missing, the
  controller POSTs that policy and does **not** PUT the Environment.

## Alternatives considered

- **Keep a human-only checklist:** rejected — not repeatable; easy to arm
  `READY` before Trusted Publishers exist.
- **Overwrite drifted Trusted Publishers:** rejected — may steal publish
  rights from another repo/workflow.
- **Auto-clear `READY` on drift:** rejected unless separately designed and
  tested. Detect + fail is the fail-closed default.
