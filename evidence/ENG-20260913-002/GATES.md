# Tag ruleset hotfix gates — ENG-20260913-002

Captured on tip `5ba58a19c0711bd55a16570534d24da0b58a65c8` against base
`184014e7bdf28832c525890c23bc1348f3ee923c`. Node `v22.14.0`, pnpm `11.23.0`.
No secrets. No `--apply`.

## Required commands

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm lint` | PASS | 4s |
| `pnpm docs:check` | PASS | 3s |
| `pnpm typecheck` | PASS | 5s |
| `pnpm schema:validate` | PASS | 2s |
| `pnpm test` | PASS | 468 tests / 45 files, 32s |
| `pnpm integration:test` | PASS | 20 tests / 5 files, 18s |
| `pnpm release:check:quick` | PASS | 56s |
| `pnpm release:check` | PASS | 156s (includes lint/docs/typecheck/schema/test/integration/conformance/benchmark/pack/dry-run/reproducibility) |

## Regression coverage (this hotfix)

| Case | Result |
| --- | --- |
| Production-shape tag read-back (`update` without parameters) → MATCH / NOOP | PASS |
| Missing `update` → STRENGTHEN / UPDATE | PASS |
| Branch-target still requires `update_allows_fetch_and_merge === false` | PASS |
| Create/update write payload still sends the parameter `false` | PASS |
| Memory apply + production-shape read-back does not loop UPDATE | PASS |

## Hosted CI (code tip `5ba58a1`)

| Workflow | Run | Result |
| --- | --- | --- |
| CI | [`34724135030`](https://github.com/hello-ai-company/ActionManifest/actions/runs/34724135030) | SUCCESS |
| Release Check | [`34724135059`](https://github.com/hello-ai-company/ActionManifest/actions/runs/34724135059) | SUCCESS |

The PR stays **DRAFT**. Do not merge from this pack.
