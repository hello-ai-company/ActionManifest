# Evidence pack — ENG-20260913-003 (Phase 2.4D agent-safe control-plane check)

**Public-safe evidence.** Identifiers and command results only. No tokens,
OTP, cookies, or Authorization material. See
[docs/PUBLIC-BOUNDARY.md](../../docs/PUBLIC-BOUNDARY.md).

## Identifiers

| Key | Value |
| --- | --- |
| Tickets | PA-20260913-003 / ENG-20260913-003 |
| Pull request | [#14 — feat(release): Phase 2.4D agent-safe control-plane check (DRAFT)](https://github.com/hello-ai-company/ActionManifest/pull/14) |
| Branch | `feat/phase-2.4d-agent-safe-control-plane-check` |
| Base | `6b1a1d231f5617f1e2494023a1e4216fdf47032b` (`main`, PR#13) |
| Hosted CI (first tip) | [`34727194435`](https://github.com/hello-ai-company/ActionManifest/actions/runs/34727194435) SUCCESS |
| Hosted Release Check (first tip) | [`34727194450`](https://github.com/hello-ai-company/ActionManifest/actions/runs/34727194450) SUCCESS |
| R1 HEAD | `9799a1ac37b660a69018d6f7e01f1b1d8e744a09` |
| Status | DRAFT — R1 in review; no merge; no production writes |

## Bans honored

Not run / not changed: `pnpm release:setup --apply`; `--audit-live` against
production (interactive npm auth); `npm trust github` / revoke; package
settings; npm login / OTP / 2FA automation; tokens; publish / stage /
approve / reject; version bump; tag; GitHub Release; `rc.1`; READY
production flip.

Production verification: **`pnpm release:setup --check-agent` only**.

## Agent Check production (read-only)

- npm live queries: **0** (`NPM LIVE GOVERNANCE: NOT QUERIED`)
- AUTH_REQUIRED items: **0**
- writes: **0**
- GitHub: repo / `release.yml` / Environment `npm-release` + `main` / tag ruleset `actionmanifest-release-tags` → **NOOP** (PR#13 tag read-back)
- Fingerprint: **CACHED_OK** (`CONTROL_PLANE_CONFIG_SHA256=c86593550ee2b66efc6c727c342703ac5ed9bb4fb8c23b7ec83569bf948cc904`)
- Verdict: `LIVE_AUDIT_REQUIRED` because this GitHub integration token cannot read Actions variable `NPM_TRUSTED_PUBLISHING_READY` (403). Fail-closed; not faked as PASS.

## R1 (ChatGPT MERGE NO-GO)

- P1-1: fingerprint now includes full SHA-256 of `.github/workflows/release.yml`.
- P1-2: secrets 403/UNKNOWN fail-closed; Agent Check must not PASS.

## Contents

| File | What it evidences |
| --- | --- |
| `GATES.md` | Local verification commands and PASS/FAIL |
| `quality-gates.log` | Captured lint / docs / typecheck / test / schema / integration / release:check:quick / release:check |
| `check-agent-production.log` | Read-only production `--check-agent` (no secrets) |
