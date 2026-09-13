# ADR 0010 — Release Control Plane

Status: Accepted
Date: 2026-09-12
Builds on: ADR 0007 (release versioning), ADR 0008 (bootstrap), ADR 0009 (canonical artifact)
Ticket: ENG-20260912-002 / CASE PA-20260912-003
Superseding note: ENG-20260913-003 / CASE PA-20260913-003 (Phase 2.4D two-layer check)

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
No `--apply` defaults to `--check` (full live path, backward compatible).
`--check-agent` and `--audit-live` are explicit. Every read-only mode
wraps write methods so they throw. CI workflows do not set
`NPM_TRUSTED_PUBLISHING_READY`.

### 2. Two-layer check / `--apply` (Phase 2.4D)

- **Normal (Agent / CI):** `pnpm release:setup --check-agent` — fully
  read-only. GitHub + local desired config + cached READY/fingerprint.
  Must not call `npm trust list`, package-security queries, npm login/2FA,
  or any npm write. Must not produce `AUTH_REQUIRED` on the normal path.
  Verdict `PASS` / `LIVE_AUDIT_REQUIRED` / `BLOCKED`. Writes=0.
- **Governance audit:** `pnpm release:setup --audit-live` — full live
  read-back including npm trust list / security / auth detection. Without
  human npm auth, `BLOCKED — NPM HUMAN AUTH REQUIRED` is an acceptable
  live outcome.
- **`--check`:** existing full live behavior (same discovery as
  `--audit-live`). **Not** silently changed into agent-only.
  Verdict `READY` / `NOT_READY` / `BLOCKED`. Zero mutations.
- **`--apply`:** print the plan, then write **only** approved control-plane
  settings, in order, then read-back. Idempotent: a second apply against a
  converged plane reports `NO CHANGES REQUIRED`. READY last.

`READY=true` is a **cached governance assertion**, not live npm proof.
Agent Check `PASS` only when READY is `true` and the
`CONTROL_PLANE_CONFIG_SHA256` fingerprint (package set, Trusted Publisher
desired config, workflow identity including the full SHA-256 of
`.github/workflows/release.yml`, control-plane config, attestation
policy/hash — no secrets/timestamps) matches. Drift →
`LIVE AUDIT REQUIRED` (or `BLOCKED` for GitHub drift). Environment
secrets GET 401/403 is `AUTH_REQUIRED`; other failures `UNKNOWN`; unread
secrets never become empty-OK and Agent Check must not `PASS`. A successful
empty secrets list is allowed. A manual attestation file is never treated
as live npm security proof.

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
the npx cache). Before any `trust` / `access` call the runner asserts
`npm --version` stdout trims to exactly `11.15.0` (fail closed on empty,
10.x, or newer). `ACTIONMANIFEST_NPM_CLI` is probed, not trusted by path
alone. Never `npm@latest`. Never a silent global replace.
Never HTML scraping.

Package security (2FA required + long-lived tokens disallowed + Trusted
Publishing used) is a READY prerequisite. Only status `OK` satisfies by
default. `MANUAL_REQUIRED` and `UNSUPPORTED` are **not** PASS and **block
READY** unless an explicit `--attest-manual-security` escape hatch is
used (see Decision 11). Empty reads never become `OK`.
`npm access set mfa=publish` is the official CLI for package-level
publish 2FA (`mfa=none|publish|automation`). Official npm docs do **not**
equate that write with Settings → Publishing access “Require two-factor
authentication and disallow tokens” (which additionally blocks granular
tokens regardless of bypass-2FA). Re-checked 2026-09-12: no official CLI
flag sets that radio. Therefore that control stays `MANUAL_REQUIRED` and
is not automated.

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

### 11. Auditable security attestation (READY is not permanently deadlocked)

`MANUAL_REQUIRED` / `UNSUPPORTED` still block READY by default (R1).
READY must remain solvable without faking `OK` from empty CLI reads.

The only escape hatch is explicit and auditable:

```bash
pnpm release:setup --check --attest-manual-security
pnpm release:setup --apply --attest-manual-security[=<path>]
```

- The flag is required. A file on disk is **not** applied silently.
- Default path: `docs/evidence/manual-package-security-attestation.json`
  (human-committed break-glass evidence). Optional local
  `release-manual-security-attestation.json` is gitignored.
- Kind must be `actionmanifest-manual-package-security-attestation`.
- Record is non-secret: who (`attestedBy`), when (`attestedAt` ISO-8601),
  which packages, and what was verified in the npm Settings UI
  (`verifiedInNpmUi` must name two-factor / 2FA **and** disallow tokens).
- Tokens / OTP / Authorization / cookies are refused.
- Placeholders (`_EXAMPLE_DO_NOT_USE`, empty packages) fail validation.
  The committed `.example.json` cannot unblock READY.
- Status stays `MANUAL_REQUIRED` / `UNSUPPORTED` (never rewritten to `OK`).
- Valid attestation covering every such package may allow READY **only
  after** other prerequisites pass. Invalid / missing / partial
  attestation still blocks. `READY=true` + `MANUAL_REQUIRED` without a
  valid attestation is CRITICAL.

## Consequences

- `pnpm release:setup --check-agent` is the preferred **normal** Agent/CI
  path. `pnpm release:setup --audit-live` (or backward-compatible
  `--check`) is the preferred **governance audit**. The npmjs.com /
  GitHub Settings UI is break-glass only.
- `pnpm release:setup --apply` is the preferred converge path when a brief
  authorizes it. Phase 2.4C implemented the controller; Phase 2.4D adds
  the agent-safe layer. Neither phase executes a production apply unless
  evidence lists that run.
- Remaining human boundary after a green plane: npm auth/2FA when the
  official CLI requests it, and later `npm stage approve` (2FA).
- Package-level “require 2FA and disallow tokens” is `MANUAL_REQUIRED` when
  it is not a safely documented official CLI write — never a fake `PASS`.
  `MANUAL_REQUIRED` / `UNSUPPORTED` block `NPM_TRUSTED_PUBLISHING_READY`
  unless `--attest-manual-security` loads a valid non-secret attestation.
- Managed tag ruleset create/update bodies are explicit GitHub REST rule
  objects. `update` always includes
  `parameters.update_allows_fetch_and_merge: false`. Compatible stronger
  extra rules are preserved; weakening is refused; ambiguous rules STOP.
  GitHub REST read-back for tag-target `update` often omits `parameters`.
  Assessment MATCH requires the `update` rule to exist (plus `deletion`,
  `non_fast_forward`, `active`, `refs/tags/v*`) — missing parameters are
  not drift. Branch-target assessment stays strict:
  `update.parameters.update_allows_fetch_and_merge === false`.
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
