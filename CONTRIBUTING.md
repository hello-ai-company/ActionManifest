# Contributing

Thank you for helping make Actions trustworthy.

## Principles

Correctness > Evidence > Safety > Interoperability > Simplicity > DX > Feature count.

Do not add execution integrations (Calendar APIs, Todoist writes, Gmail) to Core. Put them in apps that consume exporters.

Do not invent OCR, RAG, or a task manager here.

## Dev setup

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm schema:validate
pnpm benchmark:smoke
```

Node 20+. pnpm workspaces. Default extractor is deterministic (no network).

## Schema changes

1. Edit `packages/schema/src/action-manifest.schema.json`
2. Mirror types in `packages/schema/src/types.ts`
3. Bump `SCHEMA_VERSION` only with a compatibility note in `docs/SPECIFICATION.md`
4. Add fixtures that would have been invalid or ambiguous
5. Update `CHANGELOG.md`

## Fixtures

Synthetic text only (ENG-20260909-001 gate ①). No real names, schools, invoices, user mail, or copyrighted notices. Keep evidence quotes short. `pnpm test` includes `benchmark/synthetic-guard.test.ts`.

## Merge policy (ENG-20260909-001)

Do **not** merge until the President / CTO confirms. Do not file additional ENG tickets for this work. Do not commit API keys.

## PRs

- Meaningful commits (`feat(schema):`, `feat(verifier):`, `test(benchmark):`, `docs:`)
- Do not commit `.env` or API keys
- Golden fixture (`school-golden-excursion`) must stay green
