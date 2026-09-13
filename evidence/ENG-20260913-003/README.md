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
| R1 code HEAD | `9799a1ac37b660a69018d6f7e01f1b1d8e744a09` |
| R1 evidence HEAD | `065e3b8af062e3b63a9b3badb6036a2454874d1f` |
| Status | DRAFT — R1 in review; no merge; no production writes |

## Bans honored

Not run / not changed: `pnpm release:setup --apply`; `--audit-live` against
production (interactive npm auth); `npm trust github` / revoke; package
settings; npm login / OTP / 2FA automation; tokens; publish / stage /
approve / reject; version bump; tag; GitHub Release; `rc.1`; READY
production flip.

Production verification: **`pnpm release:setup --check-agent` only**.

## Agent Check production (read-only, original tip)

- npm live queries: **0** (`NPM LIVE GOVERNANCE: NOT QUERIED`)
- npm AUTH_REQUIRED: **0**
- writes: **0**
- GitHub: repo / `release.yml` / tag ruleset `actionmanifest-release-tags` → **NOOP** (PR#13 tag read-back)
- Verdict on first tip: `LIVE_AUDIT_REQUIRED` (Actions variable `NPM_TRUSTED_PUBLISHING_READY` 403). Fail-closed; not faked as PASS.

## R1 (ChatGPT MERGE NO-GO)

- P1-1: fingerprint includes full SHA-256 of `.github/workflows/release.yml` (`workflow.fileSha256`). Content edit → `WORKFLOW_CHANGED` / `LIVE AUDIT REQUIRED`. SoT `CONTROL_PLANE_CONFIG_SHA256=cf8e5a2123291c100cf2f44809e81497758276c189e0decfc61c6f35bc33df9d`.
- P1-2: Environment secrets GET 401/403 → `AUTH_REQUIRED`; other failures → `UNKNOWN`. Agent Check must not `PASS` while secrets discovery is unread. Successful empty secrets list (`OK`, `secretNames: []`) may still be OK if policy allows.
- Production `--check-agent` after R1 (`check-agent-r1.log`): verdict=`BLOCKED`; env secrets 403 `AUTH_REQUIRED` / STOP; fingerprint `CACHED_OK`; npm live **NOT QUERIED**; writes=**0**. GitHub AUTH_REQUIRED is fail-closed (not a fake PASS). npm AUTH_REQUIRED stays 0.
- Local R1 gates: `GATES-R1.md` / `quality-gates-r1.log` — all PASS.

## Contents

| File | What it evidences |
| --- | --- |
| `GATES.md` | Local verification commands and PASS/FAIL |
| `quality-gates.log` | Captured lint / docs / typecheck / test / schema / integration / release:check:quick / release:check |
| `check-agent-production.log` | Read-only production `--check-agent` (no secrets) |
