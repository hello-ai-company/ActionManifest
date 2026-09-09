# Document adapter design

Core never sees PDF bytes, images, or OCR tokens. Adapters emit `CanonicalDocument`.
The full normative contract (source identity, bbox convention, error model,
validation) lives in [INTEGRATION-CONTRACT.md](INTEGRATION-CONTRACT.md); this
note is the adapter-focused summary.

## Why

PDF libraries and OCR engines (Docling, Marker, PaddleOCR, Unstructured, Kreuzberg) each have their own page/span model. Encoding any one of them in Action Evidence would couple the Manifest to a vendor. Canonical pages and chunks are the anti-corruption layer.

## Phase 2

| Adapter | Status |
| --- | --- |
| Plain text | Working (`*.txt`, stdin-equivalent text/paths) — the reference adapter |
| Docling JSON | Working — converts parsed `DoclingDocument.export_to_dict()` output (texts/prov/pages) into canonical form, including normalized bboxes and section tracking |
| Live Docling / PDF bytes | Out of scope — run Docling upstream and pass its JSON (`NOT_IMPLEMENTED` for binary payloads) |

Adapter responsibilities end at parse/normalize. Adapters never extract
Actions, validate their own output (`assertCanonicalDocument`), and fail
explicitly with typed errors — never a silent empty document.

## Evidence locators

Prefer `source_id` + short `text`. Add `page`, `bbox`, `section`, `source_reference` when the adapter has them. The verifier requires the quote to appear in canonical text and declared pages to exist; bbox is recorded under the normalized 0..1 convention but not geometrically checked. The deterministic extractor resolves locators from the canonical document via `locateEvidence()`, so adapter provenance flows into Evidence unchanged.
