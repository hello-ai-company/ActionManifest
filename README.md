# Action Manifest

**Turn documents into actions you can verify.**

School notices, invoices, contracts, and government mail are full of things humans must actually *do* — submit a form, bring a lunch, pay a fee, show up on a rain date. Action Manifest extracts those Actions and keeps every one of them glued to source **Evidence**.

```
            ┌─ plain text ──────────────┐
            ├─ Docling JSON             ├─ adapters (parse/normalize ONLY)
Inputs ─────┼─ Xberg (native, isolated) ┘
            └─ future parsers (Marker / OCR / email / …)
                    ↓
            Canonical Document   ← parser-independent boundary
                    ↓  extractor (model is replaceable)
            Candidate Action Manifest
                    ↓  deterministic verifier
            Proposed Actions  →  human / app review  →  export (JSON / ICS, verified-only by default)
```

**Parser independence is proven, not assumed**: the same synthetic notice
flows through Docling and Xberg adapters and yields identical Actions, trust
dispositions, and calendar semantics (critical parser divergence = 0). See
[docs/PARSER-INDEPENDENCE.md](docs/PARSER-INDEPENDENCE.md) and
[docs/ADAPTER-AUTHOR-GUIDE.md](docs/ADAPTER-AUTHOR-GUIDE.md).

This is **not** a PDF summarizer, OCR engine, RAG stack, or task manager. It is a common layer other apps can trust.

## Install

> **Release status: release-candidate preparation.** The `@actionmanifest/*`
> packages are **not yet published to npm**. The first public release will be
> `0.9.0-rc.1` (see [docs/RELEASING.md](docs/RELEASING.md)). Until then, use
> the repository directly (below). The commands in this section are exactly
> what will work once published — they are verified on every PR by packing
> the tarballs and installing them into a fresh project
> (`pnpm release:dry-run`).

Once published:

```bash
# Library (pick what you need — all packages are Apache-2.0, Node >= 20)
npm install @actionmanifest/core @actionmanifest/adapters @actionmanifest/extractor \
  @actionmanifest/verifier @actionmanifest/exporters @actionmanifest/consumer

# CLI (ships the conformance suite + benchmark corpus; works from any directory)
npm install -g @actionmanifest/cli
actionman --help
npx actionman conformance        # run the official conformance suite
```

`@actionmanifest/adapter-xberg` (Node >= 22) is an **optional** package — the
native Xberg binding is never installed unless you choose it. The unscoped
npm name `actionman` belongs to an unrelated project; the CLI package is
`@actionmanifest/cli` (its bin is `actionman`).

## Quick start (from this repository)

```bash
pnpm install
pnpm actionman extract ./examples/golden-excursion.txt
pnpm actionman extract ./examples/golden-excursion.txt --json
pnpm actionman validate manifest.json --doc ./examples/golden-excursion.txt
pnpm actionman benchmark
```

The CLI commands — `extract`, `validate`, `benchmark`, `conformance` — behave
identically from an installed package; see
[apps/cli/README.md](apps/cli/README.md) for flags, exit codes, and
stdout/stderr conventions.

Verification is **per Action** (schema 0.2.0). Each Action is verified independently, so a document with one bad Action still yields trustworthy verified Actions for the rest:

```text
Verification: PARTIAL
3 actions · ✓ 2 verified · ✗ 1 failed

[VERIFIED] act_001  秋の遠足を実施する
[FAILED]   act_002  存在しない締切を提出する
   Reason: TEMPORAL_UNSUPPORTED: …
[VERIFIED] act_003  弁当を持参する
```

`actionman validate --doc <doc> --json` exposes machine-readable per-Action results in `flags.actions[]`. A manifest-level fatal (source hash mismatch, empty document) is cross-cutting and blocks all promotion; per-Action failures only stop the offending Action. See [docs/adr/0002-per-action-verification.md](docs/adr/0002-per-action-verification.md).

### Adversarial reliability

The benchmark includes an **adversarial corpus** (corrections, cancellations,
negations, quoted/superseded dates, OCR noise, conditional eligibility, …) whose
`expected.json` is human-authored truth — never a copy of extractor output. The
primary safety metric is the **False Verified Action Rate**, and CI fails on any
**critical false-verified** Action. See
[docs/ADVERSARIAL-BENCHMARK.md](docs/ADVERSARIAL-BENCHMARK.md). Integrity rule:
*Expected truth is normative; extractor output is not the oracle.*

CI uses a deterministic extractor. An OpenAI-compatible LLM is optional:

```bash
export OPENAI_API_KEY=...
pnpm actionman extract ./document.txt --provider openai
```

When you use `--provider openai`, source text **leaves the machine** toward `OPENAI_BASE_URL`. The default provider does not.

## Architecture constitution

1. **Source before inference** — Actions must link back to Evidence. Never store Actions without Evidence.
2. **Unknown stays unknown** — never invent facts (do **not** turn 「10月頃」 into `2026-10-01`).
3. **Extraction is not execution** — Core never writes to Google Calendar, email, Todoist, etc. Lifecycle: `proposed → verified → accepted → rejected → exported`.
4. **Models are replaceable** — provider interface; Phase 1 ships OpenAI-compatible + a deterministic notice extractor.
5. **Documents are replaceable** — Canonical Document + adapters. [Docling](https://github.com/docling-project/docling) is upstream; we adapt it, we do not replace it.
6. **Verification is per Action** — each Action is verified independently; one bad Action never invalidates a valid one. The manifest verdict is a summary, not a gate (Phase 1.1).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SPECIFICATION.md](docs/SPECIFICATION.md).

## Public repository boundary

**This repository is public. Every commit is public.**

Allowed here: OSS core code, **synthetic** Golden/benchmark fixtures, and architecture/spec docs.

Forbidden: real documents, customer names, real schedules copied from users, email fragments, internal memos, secrets, and Otayori-specific product features.

Core never writes to calendars, email, Todoist, or other execution APIs. Exporters emit local JSON/ICS files only.

Review owner: **PA-03E** (after this PR). Completion evidence path `evidence/ENG-20260909-001/` is reserved for **Eng ops to fill after review**.

Full list: [docs/PUBLIC-BOUNDARY.md](docs/PUBLIC-BOUNDARY.md).

## Packages

| Package (npm) | Path | Role |
| --- | --- | --- |
| `@actionmanifest/schema` | `packages/schema` | JSON Schema v0.2 (language-neutral contract; 0.1.0 still accepted) |
| `@actionmanifest/core` | `packages/core` | Canonical Document, hashing, validation, errors |
| `@actionmanifest/adapters` | `packages/adapters` | Plain Text (reference) + Docling JSON (reference adapter) |
| `@actionmanifest/adapter-xberg` | `packages/adapter-xberg` | Xberg reference adapter (native dependency isolated here; Node >= 22) |
| `@actionmanifest/temporal` | `packages/temporal` | Japanese/English temporal + modality |
| `@actionmanifest/extractor` | `packages/extractor` | ActionExtractor + providers |
| `@actionmanifest/verifier` | `packages/verifier` | Deterministic evidence checks (no LLM) |
| `@actionmanifest/consumer` | `packages/consumer` | Reference consumer policy (ready / review_required / blocked) |
| `@actionmanifest/exporters` | `packages/exporters` | JSON + ICS (VEVENT / VTODO), verified-only by default |
| `@actionmanifest/cli` | `apps/cli` | `actionman` CLI — extract / validate / benchmark / conformance |
| — (private) | `integration/reference-consumer` | External-consumer integration tests (public imports only) |
| — (not a package) | `benchmark/fixtures` | Synthetic JP+EN fixtures incl. adversarial corpus (no real PII) |

All public packages are Apache-2.0 and require Node >= 20 except
`@actionmanifest/adapter-xberg` (>= 22, Xberg's own requirement). Package
version ≠ schema version ≠ conformance suite version — see
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Using ActionManifest as a library

Third-party code integrates through the public package entry points only —
the same surface exercised by `integration/reference-consumer` against the
built packages. The snippets below are **executable**: they live in
[`docs/examples/`](docs/examples/) and are typechecked and run in CI
(`pnpm docs:examples`), so they cannot drift from the API.

```ts
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { extractActions } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";
import { classifyManifest } from "@actionmanifest/consumer";
import { exportIcs, exportJson } from "@actionmanifest/exporters";

const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id: "notice-1", text });
const candidate = await extractActions(doc);                    // deterministic by default
const { manifest } = verifyManifest(candidate, doc);            // per-Action verification
const report = classifyManifest(manifest);                      // ready / review_required / blocked
const ics = exportIcs(manifest);                                // trust-qualified only; throws on manifest-level fatal
```

Full runnable files: [docs/examples/library-quick-start.ts](docs/examples/library-quick-start.ts)
and [docs/examples/per-action-verification.ts](docs/examples/per-action-verification.ts).
Entry-point reference: [docs/API.md](docs/API.md).

Export is consumption: `exportJson` / `exportIcs` share the consumer's trust
predicate (`evaluateActionTrust` in core), so the default policy exports only
Actions whose per-Action receipt passed — `status=verified` alone is never
enough. Conditional temporals (rain dates) never become `DTSTART`/`DUE`, and
ICS UIDs are opaque hashes derived from source + action identity, stable
across documents.

Docling (Python) runs **upstream**: pass `DoclingDocument.export_to_dict()`
JSON to `DoclingAdapter`. The TypeScript core never embeds Python, never
spawns subprocesses, and CI needs no network.

**Runtime support:** Node.js >= 20 (`engines`); default CI runs on Node 20.
The optional `@actionmanifest/adapter-xberg` native bridge requires
Node >= 22 and is covered by opt-in `pnpm xberg:integration` (Node 22+).

The normative contract — CanonicalDocument fields, source identity, bbox
convention, adapter error model, consumer policy, export policy — is
[docs/INTEGRATION-CONTRACT.md](docs/INTEGRATION-CONTRACT.md). Design
rationale: [docs/adr/0004-integration-contract.md](docs/adr/0004-integration-contract.md).

## Standards & conformance

ActionManifest is an implementation-independent contract. The
**conformance suite** (`conformance/vectors/`) holds language-neutral,
schema-validated JSON vectors — hand-written from the spec, never from
implementation output — so a Python/Rust/Go implementation passing them is
*ActionManifest conformant*. Universal conformance is **semantic** (no
byte-identical ICS required); byte-exact goldens are a separate
TypeScript-only regression gate (`reference-serialization`):

```bash
pnpm conformance               # universal suite (65 vectors, 6 profiles)
pnpm conformance:reference     # + TypeScript byte-exact regression (4 goldens)
pnpm actionman conformance --json
```

Frozen v0.1/v0.2 schemas are **governance-enforced**: sha256 pins plus a
git-diff guard (`pnpm governance:validate`) that fails CI on any frozen-path
change — editing the checksum file cannot bless a schema edit. Normative
conformance changes require a `suite_version` bump, enforced the same way.

ICS export is RFC 5545-conformant at the byte level (UTF-8 octet-aware
folding, CRLF-only, injection-safe TEXT escaping, strict calendar dates,
deterministic DTSTAMP via an injectable clock). See
[docs/STANDARDS.md](docs/STANDARDS.md) (incl. known deviations),
[docs/CONFORMANCE.md](docs/CONFORMANCE.md), and
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for the versioning policy
(schema version ≠ package version ≠ suite version).

## Known limitations & experimental markers

Honest boundaries of the current `0.x` line:

- **Everything is `0.x`.** No stability promise beyond what the conformance
  suite pins ([docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)). Breaking API
  changes are possible between minors and are called out in CHANGELOG.
- **Languages**: the deterministic extractor and temporal parser target
  **Japanese and English** notices; other languages are untested.
- **Extraction quality is benchmarked, not perfect**: the deterministic
  reference extractor scores ~88% action recall / ~72% precision on the
  synthetic corpus (74 fixtures). The verifier — not the extractor — is the
  safety layer: critical false-verified is gated at 0.
- **`@actionmanifest/adapter-xberg` is experimental**: verified against
  `@xberg-io/xberg` 1.1.3 exactly (pinned), Node >= 22, native binaries via
  upstream optionalDependencies. Live native-runtime tests are opt-in
  (`pnpm xberg:integration`), not part of default CI.
- **Docling adapter** consumes the documented `export_to_dict()` subset;
  upstream Docling format changes are handled by adapter updates, never Core
  changes.
- **The CLI is not a sandbox**: it reads only paths you pass it, but do not
  run it as a privileged user on untrusted input.
- **ICS export** is RFC 5545-conformant with documented, intentional
  deviations ([docs/STANDARDS.md](docs/STANDARDS.md)).
- **Not yet published to npm** — see Install above.

## Otayori vs this OSS

This repository owns Manifest, Extractor, Verifier, Evidence, Temporal, Benchmark, CLI, Exporter, Document adapters. Product UX, family inbox, child profiles, notifications, and billing belong in Otayori — see [docs/OTAYORI-BOUNDARY.md](docs/OTAYORI-BOUNDARY.md).

## License

Apache License 2.0 — patent grant for a library other products will embed. See [LICENSE](LICENSE).
