# Architecture

Action Manifest is a **common extraction-and-verification layer**. Downstream apps (Otayori, n8n, Todoist importers, CalDAV, agents, MCP, Home Assistant, business systems) may consume manifests. They are not implemented here.

## Constitution (normative)

1. **Source before inference.** Every Action MUST include at least one Evidence object (`source_id` + quote `text`, optional `page` / `bbox` / `section`). The verifier rejects Actions whose quote is not found in the Canonical Document.
2. **Unknown stays unknown.** Temporal `type=approximate` (頃, 上旬, around October) MUST NOT carry a fabricated `date`. Year-less day+month MAY inherit a year only from an explicit era/year in the **same document**, marked via receipt/inference — never invent a day-of-month.
3. **Extraction is not execution.** Core, extractor, verifier, and exporters MUST NOT call Google Calendar, Gmail, Todoist, or any execution API. Exporters emit files (JSON, ICS). Lifecycle: `proposed → verified → accepted | rejected → exported`.
4. **Models are replaceable.** `LlmProvider` is the seam. Phase 1: `deterministic` (default, offline) and `openai-compatible`. No silent fallback between providers.
5. **Documents are replaceable.** Core understands `CanonicalDocument` only — never PDF bytes. Adapters produce canonical form. Docling/Marker/PaddleOCR are upstream engines, not in-tree competitors.

## Pipeline

```
AdapterInput
  → DocumentAdapter.toCanonical()
  → CanonicalDocument { id, sourceHash, title?, pages?, chunks?, text? }
  → ActionExtractor + LlmProvider
  → schema-validate (Ajv) — invalid JSON is an error
  → ActionManifest (status=proposed)
  → Verifier (deterministic)
  → ActionManifest (status=verified if all flags pass)
  → Exporter (JSON | ICS)   // still not execution
```

## Canonical Document

Core must not parse PDF. A Canonical Document is already text (and optional page/chunk geometry):

| Field | Meaning |
| --- | --- |
| `id` | Adapter-assigned document id |
| `sourceHash` | SHA-256 of canonical text |
| `title` | Optional |
| `pages[].pageNumber, text, chunks` | Page-level text |
| `chunks[].text, pageNumber, bbox, section, sourceReference` | Locators for Evidence |

Rationale: OCR and layout engines disagree. Normalizing once at the adapter boundary keeps Evidence locators stable and lets Docling (or Marker, Kreuzberg, Unstructured) be swapped without changing the Manifest schema.

## Receipt / provenance

Not W3C PROV-O. A small Receipt is attached so a future mapping is possible:

- `extraction`: `provider`, `model`, `extractor_version`, `schema_version`, `created_at`
- `verification`: boolean flags (`evidence_supported`, `temporal_supported`, `actor_supported`, `modality_supported`, `source_hash_matched`, `negation_conflict`, `page_refs_valid`) + `issues[]`

PROV-O mapping sketch: extraction activity used a software agent (provider/model); verification is a later activity with generated `wasDerivedFrom` Evidence entities.

## Verifier (Phase 1)

Deterministic only. An LLM-as-judge is a **future extension point**, not used here.

Checks: evidence exists; quote appears in source; declared dates/actors/modalities are supported by evidence; negation vs required-without-exemption; source hash; page refs.

## Trust order

Correctness > Evidence > Safety > Interoperability > Simplicity > DX > Feature count.

Prefer omitting a confident-wrong Action over extracting more Actions.

## Monorepo

See [adr/0001-phase0-language-and-architecture.md](adr/0001-phase0-language-and-architecture.md). JSON Schema is language-neutral; one TypeScript implementation in Phase 1 (npm CLI). No dual Python port yet. Docling remains an adapter target. Otayori is a future consumer only — not an in-repo dependency.

Public vs secret commit rules: [PUBLIC-BOUNDARY.md](PUBLIC-BOUNDARY.md). Completion gates: [ENG-20260909-001.md](ENG-20260909-001.md).

