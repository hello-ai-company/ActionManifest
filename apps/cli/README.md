# @actionmanifest/cli

`actionman` — the ActionManifest command line: extract verifiable Actions
from documents, validate manifests, run the benchmark, and check the
official conformance suite.

For local agents, `actionman agent --stdin-json` offers a typed, bounded offline
extract/reverify protocol with full manifests, classification and fixed JSON
errors. It cannot execute or approve Actions. See [agent usage](../../docs/AGENT-USAGE.md).

For the explicit new Matoe server route, `actionman analyze-matoe --stdin-json`
accepts only a bounded `sourceId`/`ocrText` JSON object on stdin and emits the full
v0.2 manifest. It always uses the actual offline DeterministicProvider, never
an environment-selected external AI. See
[the wire/error/blocked-action contract](../../docs/MATOE-SERVER-V02.md).

> **Version boundary:** npm `0.9.0-rc.0` excludes the new agent/Matoe
> entry points. This checkout prepares unpublished `0.9.0-rc.1` packages;
> identify the candidate by exact commit and tarball SHA-256. See
> [local tarball adoption](../../docs/LOCAL-CONSUMER.md).

```bash
npm install -g @actionmanifest/cli@0.9.0-rc.0  # existing release; excludes branch additions
actionman --help
actionman conformance                  # run the official conformance suite

# One-shot without global install — ALWAYS name the package explicitly:
npx --package=@actionmanifest/cli -- actionman conformance
```

> **Package identity:** the unscoped npm name `actionman` belongs to an
> unrelated project. Never let `npx` take a bare `actionman` positional —
> without `--package`, npx treats the first positional as the package
> specifier and could fetch the wrong package. Use the global bin
> (`actionman …`) or the explicit
> `npx --package=@actionmanifest/cli -- actionman …` form. (Enforced by
> `pnpm docs:check`.)

Requires Node.js >= 20. No native dependencies: the Xberg adapter is a
separate, optional package and is never installed by this CLI.

## Commands

### `actionman extract <file>`

Extract a candidate Action Manifest from a plain-text document.

| Option | Effect |
| --- | --- |
| `--json` | write the manifest JSON to stdout (pure JSON — nothing else on stdout) |
| `--out <file>` | write the manifest JSON to a file |
| `--ics <file>` | write an iCalendar (VEVENT/VTODO) export to a file |
| `--provider <name>` | `deterministic` (default, offline) or `openai` (needs `OPENAI_API_KEY`; source text leaves the machine toward `OPENAI_BASE_URL`) |
| `--skip-verify` | do not run the deterministic verifier |
| `--include-unverified` | export proposed/unverified actions too (default: verified-only) |

Exit codes: `0` success · `1` usage/IO error · `2` verification did not fully pass.

### `actionman validate <manifest>`

Validate a manifest against its frozen schema; with `--doc <file>`, also run
per-Action evidence verification against the source document.

| Option | Effect |
| --- | --- |
| `--doc <file>` | source document for evidence checks |
| `--json` | machine-readable per-Action results (`flags.actions[]`) |

Exit codes: `0` valid (and verified, with `--doc`) · `1` invalid/IO error ·
`2` verification did not fully pass.

### `actionman conformance`

Run the language-neutral universal conformance suite. **The suite is bundled
into this package** — it runs from any directory, no repository checkout
needed. Official conformance = normative docs + vector meta-schemas +
vectors; this TypeScript runner is not the spec.

| Option | Effect |
| --- | --- |
| `--root <dir>` | run a different (self-contained: manifest + schema + vectors) suite |
| `--smoke` | only the safety-critical profiles (trust, ics) |
| `--reference` | additionally run the TypeScript byte-exact serialization regression (never part of universal conformance) |
| `--json` | machine-readable report |

Exit codes: `0` conformant · `1` conformance failure · `2` runner/config error.

### `actionman benchmark`

Run the synthetic JP+EN benchmark (74 fixtures, 40 adversarial), bundled
with the package. Gated on critical false-verified = 0.

| Option | Effect |
| --- | --- |
| `--fixtures <dir>` | use a different fixture root |
| `--smoke` | small CI subset |
| `--json` | machine-readable summary |

Exit codes: `0` pass · `1` IO error · `2` golden regression or any critical
false-verified action.

## Conventions

- Data goes to **stdout**; errors go to **stderr**. `--json` output is pure
  JSON (pipeable to `jq`).
- The CLI reads only the paths you pass it (plus its bundled suite/corpus).
  It is not a sandbox; do not run it as a privileged user on untrusted
  input.

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `apps/cli`)
- Library usage: [README](../../README.md#using-actionmanifest-as-a-library)
- Conformance: [docs/CONFORMANCE.md](../../docs/CONFORMANCE.md)
- Security: [SECURITY.md](../../SECURITY.md)

Apache-2.0.

## Matoe compatibility command

`actionman prepare-matoe <manifest> --doc <exact-ocr.txt> (--out <new-bundle.json> | --json)`
creates a complete wire-plus-audit bundle for the explicit Matoe v0.1 profile.
The default extraction schema remains v0.2. See
[the integration guide](../../docs/MATOE-COMPATIBILITY.md) before sending its
`manifest` member to a backend. The command makes no network calls.
Choose file output (mode 0600) or explicitly print the complete original/audit
bundle with `--json`. It does not implicitly print source-derived private data.

## Offline multi-document batch analysis

`actionman agent-batch --stdin-json < examples/agent-batch.json` reads a batch v1
JSON envelope with 1–16 `{ item_id, request }` entries. Each request uses the existing
agent v1 `extract` or `verify` protocol. Stable ASCII item IDs (1–64 characters,
letters/digits followed by letters/digits/dot/underscore/hyphen) must be unique.
The command never uses a live provider, even if provider environment variables are set.

The report preserves input order and full per-document manifests, verification
failures, and exact claimed source ID/text SHA256 plus request fingerprint. Failed
items retain sanitized error codes, not raw diagnostics. Success for one item does
not discard failures in another. Repeated source IDs trigger `REPEATED_SOURCE` or
`SOURCE_ID_CONFLICT` review entries. Nothing is merged or deduplicated, and source
identity is not authenticated. Same hashes are correlation data, not approval or
execution idempotency keys. Counts describe supplied document candidates only;
zero actions does not prove there are no obligations in a document.

Limits: 2 MiB aggregate UTF-8 JSON, 16 items, 28 nesting levels and 100,000 traversal
nodes (including object keys), plus each existing agent request's own budgets.
All items are cloned before asynchronous analysis; processing is sequential and
offline. The public `@actionmanifest/cli/agent-batch` entry point exports `runAgentBatch`,
`readAgentBatchStdin`, `agentBatchFailure`, and `AGENT_BATCH_LIMITS`. Its
JavaScript API accepts inert JSON data only, not hostile
Proxy objects. Getters, custom `toJSON`, cycles and non-JSON values are rejected.

Exit codes: 0 = all documents analyzed without blocked/review-required rows or
source review entries; 2 = complete report with one or more failed items, blocked
rows, review-required rows or source reviews; 1 = invalid envelope/input/command.
`ok: true` means every item was analyzed, not that its actions passed verification.
JSON goes to stdout for both success and failure. Standalone `--help` is human output;
other flags cannot enable execution or change providers. Output includes source
quotes and titles, so choose a private destination and do not treat it as anonymized.
The report cannot grant permission, authenticate an issuer or prove real-world completion.

## Offline document questions

`actionman ask-document notice.txt --kind cost --subject 遠足 --include-evidence`
returns exact source excerpts and adjacent context, with no model/network call.
Use `--canonical-json` for parsed canonical documents with page provenance.
Supported kinds: search, deadline, cost, requirements, contact and table.
This is bounded local extractive retrieval, not semantic AI. See
[document question limits](../../docs/DOCUMENT-QUESTIONS.md).

## Family evidence review (v8 local source candidate)

`actionman review-family notice.txt --include-evidence` pages exact source
passages with family domain/topic hints and caution flags. Use `--offset`,
`--limit`, `--domain` and `--topic` for bounded navigation; `--canonical-json`
preserves real page provenance. No provider or execution is invoked. Unknown
passages remain accessible under `other`. See [scope and limits](../../docs/FAMILY-REVIEW.md).
