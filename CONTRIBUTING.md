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

Versioned schemas are **immutable**: never edit a shipped `schemas/vX.Y/action-manifest.schema.json`. Instead:

1. Add a new immutable schema `packages/schema/schemas/v<next>/action-manifest.schema.json` (`$id …/v<next>/…`, `schema_version const`)
2. Register it in `actionManifestSchemasByVersion` (`packages/schema/src/index.ts`) and add the version to `SUPPORTED_SCHEMA_VERSIONS` / `SCHEMA_VERSION` in `packages/schema/src/types.ts`
3. Mirror types in `packages/schema/src/types.ts`; bump `SCHEMA_VERSION` only with a compatibility note in `docs/SPECIFICATION.md`
4. Add fixtures that would have been invalid or ambiguous
5. Update `CHANGELOG.md`

The reader (`validateActionManifest`) dispatches by `schema_version`, so a manifest can never carry fields from another version.

## Fixtures

Synthetic text only (ENG-20260909-001 gate ①). No real names, schools, invoices, user mail, or copyrighted notices. Keep evidence quotes short. `pnpm test` includes `benchmark/synthetic-guard.test.ts`.

### Adversarial benchmark integrity (normative)

> **Expected truth is normative. Extractor output is not the oracle.**

For adversarial fixtures (`benchmark/fixtures/**` tagged `adversarial`), author
`expected.json` as human semantic truth **before** comparing to the extractor,
and add benchmark-only `must_not_extract` negative expectations. See
[docs/ADVERSARIAL-BENCHMARK.md](docs/ADVERSARIAL-BENCHMARK.md).

Reviewer guidance when a fixture or `expected.json` changes:

- **Reject** any change that edits `expected.json` to match current extractor
  output in order to make a failing test pass. Fix the extractor/verifier
  (minimally) instead, or record a tracked gap.
- A dropped `must_not_extract` entry, a severity downgraded from `critical`, or a
  new fixture with no negative expectation for an adversarial case needs an
  explicit rationale.
- CI must show **critical false-verified = 0**; never relax that gate to land a change.
- `must_not_extract` and the failure taxonomy are **benchmark-only** — they must
  never be added to the production Action Manifest schema.

## Merge policy (ENG-20260909-001)

Do **not** merge until the President / CTO confirms. Do not file additional ENG tickets for this work. Do not commit API keys.

## PRs

- Meaningful commits (`feat(schema):`, `feat(verifier):`, `test(benchmark):`, `docs:`)
- Do not commit `.env` or API keys
- Golden fixture (`school-golden-excursion`) must stay green
