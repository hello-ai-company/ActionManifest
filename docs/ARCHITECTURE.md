# Architecture

Action Manifest is a **common extraction-and-verification layer**. Downstream apps (Otayori, n8n, Todoist importers, CalDAV, agents, MCP, Home Assistant, business systems) may consume manifests. They are not implemented here.

## Constitution (normative)

1. **Source before inference.** Every Action MUST include at least one Evidence object (`source_id` + quote `text`, optional `page` / `bbox` / `section`). The verifier rejects Actions whose quote is not found in the Canonical Document.
2. **Unknown stays unknown.** Temporal `type=approximate` (頃, 上旬, around October) MUST NOT carry a fabricated `date`. Year-less day+month MAY inherit a year only from an explicit era/year in the **same document**, marked via receipt/inference — never invent a day-of-month.
3. **Extraction is not execution.** Core, extractor, verifier, and exporters MUST NOT call Google Calendar, Gmail, Todoist, or any execution API. Exporters emit files (JSON, ICS). Lifecycle: `proposed → verified → accepted | rejected → exported`.
4. **Models are replaceable.** `LlmProvider` is the seam. Phase 1: `deterministic` (default, offline) and `openai-compatible`. No silent fallback between providers.
5. **Documents are replaceable.** Core understands `CanonicalDocument` only — never PDF bytes. Adapters produce canonical form. Docling/Marker/PaddleOCR are upstream engines, not in-tree competitors.
6. **Verification is per Action** (Phase 1.1). Each Action is verified independently from its own Evidence/Temporal/Actor/Modality/Negation. One Action's failure MUST NOT invalidate an unrelated Action. The manifest-level verdict is a *summary* of per-Action results, not a gate that blocks valid Actions. See [adr/0002-per-action-verification.md](adr/0002-per-action-verification.md).

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
- `verification` (v0.1 summary, still present): boolean flags (`evidence_supported`, `temporal_supported`, `actor_supported`, `modality_supported`, `source_hash_matched`, `negation_conflict`, `page_refs_valid`) + `issues[]`. Each boolean is the AND-aggregate across Actions (`negation_conflict` is the OR-aggregate).
- `verification` (v0.2 additive, optional): `passed`, `total_actions`, `verified_actions`, `failed_actions`, `warning_actions`, and `actions[]` — a per-Action `ActionVerificationResult` array. Old readers ignore these; new readers get per-Action trust.

PROV-O mapping sketch: extraction activity used a software agent (provider/model); verification is a later activity with generated `wasDerivedFrom` Evidence entities.

### Fatal vs per-Action failures

| Class | Examples | Effect |
| --- | --- | --- |
| **Manifest-level fatal** (cross-cutting) | source hash mismatch, empty canonical document, schema-invalid / corrupted manifest | Document/manifest is untrustworthy → no Action is promoted to `verified`, even ones that pass intrinsically. |
| **Per-Action failure** | evidence not in source, temporal hallucination, actor unsupported, modality unsupported, negation conflict, invalid page ref for one Action | Only that Action fails; other Actions are unaffected. |

`source_hash_matched` is a summary/fatal signal; a per-Action result never folds it in, so `actions[].passed` always reflects that Action's intrinsic verdict.

**Evidence source identity.** Beyond "the quote appears in the source", each Evidence's `source_id` MUST belong to the current canonical source (manifest `source.id` or document id). A mismatch is a **per-Action** verification failure (`EVIDENCE_SOURCE_ID`, error) — not a warning and not manifest-level fatal — enforcing *source before inference*.

### Immutable versioned schemas

Schemas are **versioned and immutable**: each `schema_version` has its own frozen JSON Schema under `packages/schema/schemas/<version>/`. `validateActionManifest()` identifies `schema_version` first and dispatches to the exact schema (`0.1.0` → v0.1, `0.2.0` → v0.2, otherwise Unsupported), failing closed on a non-object payload or missing/non-string version. Therefore a `0.1.0` manifest **cannot** carry v0.2-only fields; the frozen v0.1 schema has none. See [adr/0002-per-action-verification.md](adr/0002-per-action-verification.md).

## Verifier (Phase 1)

Deterministic only. An LLM-as-judge is a **future extension point**, not used here.

Checks (run **per Action**): evidence exists; quote appears in source; declared dates/actors/modalities are supported by evidence; negation vs required-without-exemption; page refs. Source hash is a manifest-level (fatal) check. Status promotion is per Action: `proposed → verified` only when that Action passes AND there is no manifest-level fatal failure. `verificationPassed()` reports the manifest-level verdict; `actionVerificationPassed()` reports a single Action's.

Actor rule (Phase 1.1): `explicit` requires `actor.text` present **and** found in that Action's evidence; `implicit` text is optional and not forced to match; `unknown` never invents an actor.

## Trust order

Correctness > Evidence > Safety > Interoperability > Simplicity > DX > Feature count.

Prefer omitting a confident-wrong Action over extracting more Actions.

## Monorepo

See [adr/0001-phase0-language-and-architecture.md](adr/0001-phase0-language-and-architecture.md). JSON Schema is language-neutral; one TypeScript implementation in Phase 1 (npm CLI). No dual Python port yet. Docling remains an adapter target. Otayori is a future consumer only — not an in-repo dependency.

Public vs secret commit rules: [PUBLIC-BOUNDARY.md](PUBLIC-BOUNDARY.md). Completion gates: [ENG-20260909-001.md](ENG-20260909-001.md).

