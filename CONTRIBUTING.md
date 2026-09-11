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

Node >= 20 to consume; toolchain (pnpm 11.23.0 / canonical pack) needs
Node >= 22. pnpm workspaces. Default extractor is deterministic (no network).

## CI gates (all must be green)

`pnpm release:check` runs the full chain locally. Individually:

| Command | What it proves |
| --- | --- |
| `pnpm governance:validate` | Frozen v0.1/v0.2 schemas untouched; normative conformance changes carry a `suite_version` bump |
| `pnpm lint` / `pnpm typecheck` | Style / types (packages + external reference consumer against built d.ts) |
| `pnpm schema:validate` | Schema identity, dialect, frozen sha256 checksums |
| `pnpm test` | Unit tests (253+) |
| `pnpm integration:test` | External-consumer integration (public entry points only, built dist) |
| `pnpm conformance` | Universal suite 65/65, critical false exported = 0 |
| `pnpm conformance:reference` | TypeScript byte-exact ICS regression (4/4) |
| `pnpm benchmark:smoke` / `pnpm benchmark` | Golden + adversarial (74 fixtures, 40 adversarial), critical false-verified = 0 |
| `pnpm pack:check` | Every public package packs; tarballs contain dist/LICENSE/NOTICE and no tests; standalone consumers typecheck + run with declared deps only; CLI installs and runs from a foreign cwd |
| `pnpm docs:examples` | README examples are executable and typechecked |
| `pnpm release:dry-run` | Release artifacts (tarballs, SHA256SUMS, manifest, SBOM) without any registry write |
| `pnpm release:check:quick` | PR quick path: pack:check + docs examples + dry-run (the Release Check workflow runs this on PRs; the full chain runs on main/tags/dispatch) |

`pnpm release:check` is verification-only: it never publishes, never tags,
never creates GitHub Releases, and fails closed if registry credentials are
present in the environment. See [docs/RELEASING.md](docs/RELEASING.md).

## Packaging rules (Phase 2.2/2.3)

- Public entry points only: each package's `exports` map is the contract;
  deep imports are blocked and not covered by semver.
- Declare every dependency your public `.d.ts` references — `pnpm pack:check`
  scans shipped declarations and fails on undeclared references.
- Never add a dependency on `@xberg-io/*` outside `@actionmanifest/adapter-xberg`
  (enforced by `pack:check`), and never make the CLI depend on the native
  adapter (the CLI stays Node 20 capable).
- `@xberg-io/xberg` is pinned exactly (ADR 0007). Do not widen the range
  without re-verifying the adapter against the new version's installed types.
- Keep `sideEffects: false` accurate: libraries are pure export modules; the
  CLI entry point executes on import and must not declare it.

## Release process

Releases are prepared, never improvised: see [docs/RELEASING.md](docs/RELEASING.md)
for preconditions, version selection (package ≠ schema ≠ suite version),
publish order, dry-run, Trusted Publishing prerequisites, and rollback policy.
The scorecard lives in [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md).
Only maintainers with the release role run the real publish; everyone else
stops at `pnpm release:dry-run`.

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
