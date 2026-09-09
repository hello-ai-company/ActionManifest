# ADR 0001 — Phase 0: Language, layout, and v0.1 model

Status: Accepted  
Date: 2026-09-09  
Case: PA-20260909-001

## Context

Action Manifest is a model-agnostic, document-parser-agnostic OSS layer. Phase 1 must ship a trustworthy schema, extractor interface, deterministic verifier, Japanese temporal/modality handling, CLI, exporters, and a benchmark — not a PDF app, OCR engine, or task manager.

The repo was empty (README stub only). We need one implementation language plus a language-neutral schema.

## Decision

**Language-neutral JSON Schema v0.1 as the contract**, with **one primary implementation: TypeScript** (Node 22, pnpm workspaces, ESM).

We will **not** dual-implement Python and TypeScript in Phase 1.

### Why TypeScript (not Python, not dual)

| Option | Fit | Phase 1 cost |
| --- | --- | --- |
| TS + JSON Schema | Otayori (likely TS), npm CLI, Ajv validation, ICS as text, GitHub Actions | One toolchain |
| Python + JSON Schema | Docling/PaddleOCR ecosystem, scientific NLP | Weaker npm CLI / Otayori path; still need a JS CLI later |
| Dual TS+Python | Interop theater | Violates “do not dual-implement everything”; doubles tests |

Docling remains an **upstream adapter**, not an in-process Python dependency. Phase 1 ships a working Plain Text adapter and a Docling adapter **interface + fixtures** only.

### Layout

```
packages/schema      JSON Schema + generated/hand types
packages/core        CanonicalDocument, Action types, errors, hashing
packages/adapters    Plain text (required), Docling (interface + fixtures)
packages/temporal    JP/EN temporal + modality (deterministic)
packages/extractor   ActionExtractor + OpenAI-compatible + mock providers
packages/verifier    Deterministic evidence/temporal/actor/modality checks
packages/exporters   JSON + ICS (+ VTODO)
apps/cli             `actionman` (provisional name)
benchmark/fixtures   Synthetic JP+EN inputs + expected manifests
docs/                Architecture, spec, ADRs, Phase 1 report
```

Internal project name: **action-manifest**. Product name is **not** frozen (`actionman` / OpenNotice are provisional).

### v0.1 model (summary)

- Actions **always** carry Evidence (source quote + locator). No Action without Evidence.
- Temporal types: `exact | approximate | range | relative | recurring | conditional | unknown`. Approximate expressions (**頃**, **上旬**) **must not** become a calendar day.
- Review lifecycle: `proposed → verified → accepted | rejected → exported`. Core never executes (no Calendar/Todoist writes).
- Receipt: extraction provenance + deterministic verification flags (not full W3C PROV-O; mappable later).
- Enums are forward-compatible via `x-*` extension strings.
- Extractor tests use a **mock provider** in CI. Live OpenAI-compatible calls are opt-in via env. A **deterministic notice extractor** is also a provider so the Golden Fixture can pass without network.

### Dependencies (Phase 1)

- `ajv` + `ajv-formats` — schema validation
- `commander` — CLI
- `vitest` — tests
- `typescript` / `eslint` — typecheck + lint
- Node `fetch` for OpenAI-compatible HTTP (no SDK required)
- Zero OCR, vector DB, or UI libraries

Reuse: JSON Schema Draft 2020-12, iCalendar RFC 5545 (hand-rolled serializer; no Google Calendar API).

### Out of scope (Phase 1)

Custom OCR/PDF renderer, RAG, chat UI, accounts, Supabase/Firebase/Stripe, Gmail/Calendar OAuth, mobile, family sharing, notifications, full task/document managers, workflow builders, live Docling/Marker/PaddleOCR engines, Otayori product features.

## Risks

| Risk | Mitigation |
| --- | --- |
| LLM hallucinates exact dates from 「10月頃」 | Deterministic verifier rejects exact dates unsupported by evidence |
| Golden Fixture needs an LLM | Deterministic provider + expected fixture; live LLM optional |
| Year-less 「10月5日」 | Inherit year only from **explicit era/year in the same document**; mark inferred. Never invent a day. |
| Over-copying PII into evidence | Evidence is a short quote (sentence), never the full document; logs omit body text |
| Naming churn | CLI name is provisional; packages scoped `@actionmanifest/*` |

## Consequences

All code must obey the Architecture Constitution in `docs/ARCHITECTURE.md`. Schema changes bump `schema_version` per the compatibility policy in `docs/SPECIFICATION.md`.
