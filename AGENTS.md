# AGENTS.md

## Product and toolchain

ActionManifest monorepo (`packages/*` + `apps/*`): turn documents into verifiable actions.

- Package manager: `pnpm@11.23.0` (exact pin).
- Consumer runtime: Node `>=20` for published packages in the normal path.
- `adapter-xberg`: Node `>=22`.
- Release / build tooling: Node 22+.
- Do not assume every local or CI command runs under Node 20. Do not change `engines` fields unless the brief explicitly scopes that change.

## Default operating rules

- Implement only the scoped paths in the Cloud Agent brief.
- Prefer one PR tip; one fix bundle for review comments.
- Keep the PR Draft unless the brief explicitly permits undraft/merge **and** required checks / rulesets allow it.
- Do not widen into unrelated repositories or products unless the brief explicitly includes cross-repository work.
- Do not open parallel Cloud Agents for the same ENG.
- Do not delete tests to make CI green.
- Run the Verification commands that match the change size, and record non-secret summaries in the Eng evidence path named in the brief.

## Prohibited by default

Agents MUST NOT:

- Bypass branch protection, required CI, or the FULL Release Check.
- Publish outside the approved release workflow.
- Create or delete protected release tags arbitrarily.
- Weaken Trusted Publishing.
- Introduce long-lived npm tokens.
- Automate or bypass npm 2FA proof-of-presence / WebAuthn / security-key challenges.
- Extract or store OTPs.
- Mutate production or release infrastructure unless the brief explicitly authorizes that work.
- Run ad-hoc `npm publish`, `npm unpublish`, `npm dist-tag add`, or `npm dist-tag rm`.

## Explicitly authorized automation

If the task brief explicitly names **release-control-plane** or release-infrastructure work, the Agent MAY implement or configure **only** the operations that brief authorizes (examples: GitHub Environment, ruleset, repository variable, Trusted Publisher configuration, release workflow configuration) — and only when those items are specifically included.

Trusted Publishing and release-infrastructure changes are forbidden by default. They are allowed only when the brief explicitly scopes release-control-plane setup or maintenance.

When authorized, use the two-layer controller (do not ad-hoc `gh` /
`npm trust` / UI clicks):

- **Normal (Agent / CI):** `pnpm release:setup --check-agent` — read-only;
  GitHub + cached READY + live-approved `NPM_TRUSTED_PUBLISHING_CONFIG_SHA256`
  + committed fingerprint; no npm live queries. `PASS` requires the
  live-approved hash (outside the repo) to match the computed fingerprint.
- **Governance audit:** `pnpm release:setup --audit-live` — full live
  read-back (npm trust list / security / auth). May persist the approved
  config SHA after success; never flips READY. `--check` keeps this
  live behavior for compatibility, stays write-free, and is **not**
  agent-only.
- **Mutation:** `pnpm release:setup --apply` (explicit, idempotent,
  READY last) only when the brief authorizes writes.

Do not flip `NPM_TRUSTED_PUBLISHING_READY` casually. Flip it only when an
explicit release-control-plane task (1) verifies all prerequisites,
(2) confirms configuration is complete, and (3) explicitly authorizes the
readiness change. `READY=true` alone is not live npm proof. Keep
Phase 2.4B fail-closed. Never automate `npm stage approve` or 2FA /
WebAuthn / security-key proof-of-presence.

## Release safety boundary

Current production architecture (document only; this file does not implement it):

canonical CI artifact → exact-SHA FULL Release Check → OIDC → npm stage publish → human 2FA approval → registry verification

Release writes go only through that approved architecture, and only when the brief explicitly authorizes release execution. Do not weaken staged publishing.

Agents MUST NOT bypass or simulate `npm stage approve`, 2FA challenge completion, or security-key / WebAuthn.

This file and a typical documentation PR do **not** implement the Release Control Plane.

## Verification

Pick checks by scope. Do not run expensive full-release checks for a one-line documentation-only PR unless the brief asks or a release-readiness claim is being made.

- Documentation-only: `pnpm docs:check`
- Normal code: `pnpm lint` · `pnpm typecheck` · `pnpm test`
- Schema / API: also `pnpm schema:validate`
- Adapter / integration: also `pnpm integration:test`
- Release-shaped: `pnpm release:check:quick`
- Full release changes: `pnpm release:check` when explicitly requested, or before any release-readiness claim

## Evidence and secrets

Never put any of the following in logs, PR bodies, evidence, or committed files: npm token, GitHub token, OIDC token, OTP, WebAuthn credential, authId, cookie, `Authorization` header, or other private credential material.

Evidence is non-secret identifiers and command results only. Done = evidence gate, not “agent finished”.

## Merge / approval boundary

Merge may be automated only when: the brief explicitly permits merge **and** required checks are green **and** branch / ruleset policy permits it. Otherwise remain Draft / unmerged. Never bypass protection.

Operating model: default deny + explicit brief authorization + existing repository safety gates. This is **not** “everything always requires a human to execute the work.”
