# Phase 2.4D public gate checklist — ENG-20260913-003

Local + hosted gates. No tokens, OTP, cookies, or Authorization material.

## Local verification

| Command | Status | Notes |
| --- | --- | --- |
| `pnpm lint` | PENDING | fill after run |
| `pnpm docs:check` | PENDING | |
| `pnpm typecheck` | PENDING | |
| `pnpm test` | PENDING | |
| `pnpm schema:validate` | PENDING | |
| `pnpm integration:test` | PENDING | |
| `pnpm release:check:quick` | PENDING | |
| `pnpm release:check` | PENDING | |
| `pnpm release:setup --check-agent` (production, read-only) | PENDING | expect GitHub OK, tag NOOP, npm live NOT QUERIED, AUTH_REQUIRED 0, writes 0 |

## Forbidden (not run)

- `pnpm release:setup --apply`
- `pnpm release:setup --audit-live` (production / interactive auth)
- `npm trust github` / revoke / publish / stage / approve
- READY flip / version bump / tag / GitHub Release / rc.1
