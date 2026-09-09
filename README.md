# Action Manifest

**Turn documents into actions you can verify.**

School notices, invoices, contracts, and government mail are full of things humans must actually *do* — submit a form, bring a lunch, pay a fee, show up on a rain date. Action Manifest extracts those Actions and keeps every one of them glued to source **Evidence**.

```
Document / Email / OCR / Structured
        ↓  adapter (plain text now; Docling later)
 Canonical Document
        ↓  extractor (model is replaceable)
 Candidate Action Manifest
        ↓  deterministic verifier
 Proposed Actions  →  human / app review  →  export (JSON / ICS)
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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SPECIFICATION.md](docs/SPECIFICATION.md).

## Packages

| Path | Role |
| --- | --- |
| `packages/schema` | JSON Schema v0.1 (language-neutral contract) |
| `packages/core` | Canonical Document, hashing, validation, errors |
| `packages/adapters` | Plain Text (working), Docling (interface + fixtures) |
| `packages/temporal` | Japanese/English temporal + modality |
| `packages/extractor` | ActionExtractor + providers |
| `packages/verifier` | Deterministic evidence checks (no LLM) |
| `packages/exporters` | JSON + ICS (VEVENT / VTODO) |
| `apps/cli` | `actionman` CLI (name is provisional) |
| `benchmark/fixtures` | Synthetic JP+EN fixtures (no real PII) |

## Otayori vs this OSS

This repository owns Manifest, Extractor, Verifier, Evidence, Temporal, Benchmark, CLI, Exporter, Document adapters. Product UX, family inbox, child profiles, notifications, and billing belong in Otayori — see [docs/OTAYORI-BOUNDARY.md](docs/OTAYORI-BOUNDARY.md).

## License

Apache License 2.0 — patent grant for a library other products will embed. See [LICENSE](LICENSE).
