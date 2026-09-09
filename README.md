# Action Manifest

**Turn documents into actions you can verify.**

School notices, invoices, contracts, and government mail are full of things humans must actually *do* — submit a form, bring a lunch, pay a fee, show up on a rain date. Action Manifest extracts those Actions and keeps every one of them glued to source **Evidence**.

```
Document / Email / OCR / Structured
        ↓  adapter (plain text; Docling JSON)
Canonical Document
        ↓  extractor (model is replaceable)
Candidate Action Manifest
        ↓  deterministic verifier
Proposed Actions  →  human / app review  →  export (JSON / ICS, verified-only by default)
```

This is **not** a PDF summarizer, OCR engine, RAG stack, or task manager. It is a common layer other apps can trust.

## Quick start

```bash
pnpm install
pnpm actionman extract ./examples/golden-excursion.txt
pnpm actionman extract ./examples/golden-excursion.txt --json
pnpm actionman validate manifest.json --doc ./examples/golden-excursion.txt
pnpm actionman benchmark
```

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

| Path | Role |
| --- | --- |
| `packages/schema` | JSON Schema v0.2 (language-neutral contract; 0.1.0 still accepted) |
| `packages/core` | Canonical Document, hashing, validation, errors |
| `packages/adapters` | Plain Text (reference) + Docling JSON (reference adapter) |
| `packages/temporal` | Japanese/English temporal + modality |
| `packages/extractor` | ActionExtractor + providers |
| `packages/verifier` | Deterministic evidence checks (no LLM) |
| `packages/consumer` | Reference consumer policy (ready / review_required / blocked) |
| `packages/exporters` | JSON + ICS (VEVENT / VTODO), verified-only by default |
| `apps/cli` | `actionman` CLI (name is provisional) |
| `integration/reference-consumer` | External-consumer integration tests (public imports only) |
| `benchmark/fixtures` | Synthetic JP+EN fixtures incl. adversarial corpus (no real PII) |

## Using ActionManifest as a library

Third-party code integrates through the public package entry points only —
the same surface exercised by `integration/reference-consumer` against the
built packages:

```ts
import { DoclingAdapter, PlainTextAdapter } from "@actionmanifest/adapters";
import { extractActions } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";
import { classifyManifest } from "@actionmanifest/consumer";
import { exportIcs, exportJson } from "@actionmanifest/exporters";

const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id: "notice-1", text });
const candidate = await extractActions(doc);                    // deterministic by default
const { manifest } = verifyManifest(candidate, doc);            // per-Action verification
const report = classifyManifest(manifest);                      // ready / review_required / blocked
const ics = exportIcs(manifest);                                // verified-only; throws on manifest-level fatal
```

Docling (Python) runs **upstream**: pass `DoclingDocument.export_to_dict()`
JSON to `DoclingAdapter`. The TypeScript core never embeds Python, never
spawns subprocesses, and CI needs no network.

**Runtime support:** Node.js >= 20 (`engines`), developed and tested on
Node 22.

The normative contract — CanonicalDocument fields, source identity, bbox
convention, adapter error model, consumer policy, export policy — is
[docs/INTEGRATION-CONTRACT.md](docs/INTEGRATION-CONTRACT.md). Design
rationale: [docs/adr/0004-integration-contract.md](docs/adr/0004-integration-contract.md).

## Otayori vs this OSS

This repository owns Manifest, Extractor, Verifier, Evidence, Temporal, Benchmark, CLI, Exporter, Document adapters. Product UX, family inbox, child profiles, notifications, and billing belong in Otayori — see [docs/OTAYORI-BOUNDARY.md](docs/OTAYORI-BOUNDARY.md).

## License

Apache License 2.0 — patent grant for a library other products will embed. See [LICENSE](LICENSE).
