# Diff summary vs `main` (ENG-20260909-001)

`main` was an empty README stub (~17 bytes). This branch adds the Phase 1 OSS plus the completion-gate pack.

## Scale (at evidence capture)

See `diff-shortstat.txt` / `diff-stat.txt` for `origin/main...HEAD` at generation time. The gate follow-up commit adds `docs/PUBLIC-BOUNDARY.md`, `docs/ENG-20260909-001.md`, guard tests, CI pnpm fix, and this `evidence/` directory.

## By area

| Area | Change |
| --- | --- |
| `packages/schema` | JSON Schema v0.1 + types |
| `packages/core` | Canonical document, hash, Ajv validation — **no network** |
| `packages/adapters` | Plain text + Docling fixture mapper |
| `packages/temporal` | JP/EN temporal and modality |
| `packages/extractor` | Deterministic + optional OpenAI-compatible (inference only) |
| `packages/verifier` | Deterministic evidence checks |
| `packages/exporters` | JSON + ICS **files** |
| `apps/cli` | `actionman` |
| `benchmark/fixtures` | 29 **synthetic** JP/EN fixtures + Golden |
| `docs/` | Architecture, spec, Otayori **boundary**, public boundary, gates |
| `evidence/ENG-20260909-001/` | This pack |
| OSS | Apache-2.0, CONTRIBUTING, CoC, SECURITY, CI |

## Intentionally absent from the diff

Google Calendar / Gmail / Todoist writes, Otayori app code, real user documents, API keys, new ENG GitHub issues, a merge commit.
