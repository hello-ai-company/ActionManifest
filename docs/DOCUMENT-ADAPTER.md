# Document adapter design

Core never sees PDF bytes, images, or OCR tokens. Adapters emit `CanonicalDocument`.

## Why

PDF libraries and OCR engines (Docling, Marker, PaddleOCR, Unstructured, Kreuzberg) each have their own page/span model. Encoding any one of them in Action Evidence would couple the Manifest to a vendor. Canonical pages and chunks are the anti-corruption layer.

## Phase 1

| Adapter | Status |
| --- | --- |
| Plain text | Working (`*.txt`, stdin-equivalent files) |
| Docling JSON fixture | Maps `pages[]` / `texts[]` into canonical pages/chunks |
| Live Docling / PDF | Out of scope — `NOT_IMPLEMENTED` |

## Evidence locators

Prefer `source_id` + short `text`. Add `page`, `bbox`, `section`, `source_reference` when the adapter has them. Verifier Phase 1 requires the quote to appear in canonical text; bbox is recorded but not geometrically checked.
