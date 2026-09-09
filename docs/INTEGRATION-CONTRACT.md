# Integration Contract (Phase 2)

How external systems connect to ActionManifest safely. The audience is a
third-party developer integrating a document parser, or an application
consuming verified Actions.

```
External Document Parser (Docling / plain text / future OCR / email)
        ↓  DocumentAdapter (parse + normalize ONLY)
CanonicalDocument  ← the interoperability boundary
        ↓  ActionExtractor (models are replaceable)
Action Manifest (schema 0.2.0)
        ↓  Verifier (deterministic, per Action)
Verified Actions
        ↓  Reference Consumer policy (@actionmanifest/consumer)
        ↓  Exporters (verified-only by default)
JSON / ICS (VEVENT / VTODO) / your application
```

The constitution is unchanged: source before inference, unknown stays
unknown, extraction is not execution, models are replaceable, documents are
replaceable, verification is per Action.

## 1. CanonicalDocument — the boundary

Core understands **only** `CanonicalDocument`. It never sees PDF bytes, OCR
tokens, or parser-native structures. Every field except `id` is optional so
geometry-less inputs (plain text, email bodies) remain first-class.

| Field | Required | Convention |
| --- | --- | --- |
| `id` | **yes** | Adapter-assigned source identity. Stable for the same input document. |
| `sourceHash` | recommended | SHA-256 hex (64 lowercase chars) of the **canonical text** (see §3). Computed by the adapter via `ensureSourceHash()` when the upstream parser has no equivalent hash. |
| `title` | no | Human-readable title. |
| `mediaType` | no | MIME type of the origin (e.g. `application/pdf`, `text/plain`). |
| `language` | no | BCP-47-ish tag (`ja`, `en`, …). |
| `text` | no* | Full document text. |
| `pages[]` | no* | `{ pageNumber (1-based), text, chunks? }`. |
| `chunks[]` | no* | `{ text, pageNumber?, bbox?, section?, sourceReference? }` — blocks/spans. |
| `metadata` | no | Adapter-specific extras (`adapter`, `adapter_version`, `warnings`, upstream hashes). Never required by Core. |

\* At least one of `text` / page text / chunk text must be non-empty
(`EMPTY_DOCUMENT` otherwise).

### bbox convention (normative)

`BoundingBox = { x, y, width, height }`, **normalized to 0..1 relative to the
page**, origin **top-left**, x→right, y→down; `{x, y}` is the top-left corner.

Adapters MUST convert into this convention only when the input coordinate
system and page size are known. If either is unknown, the adapter MUST omit
the bbox (unknown stays unknown) — never guess a 0..1 normalization, never
store absolute pixels/points as if they were normalized. See ADR 0004 for the
Phase 2.x escape hatch (explicit coordinate-system metadata) should a future
parser need absolute coordinates.

### Validation at the trust boundary

External input is not trusted. Two layers:

- `validateCanonicalDocument(data)` — JSON Schema validation (structure).
- `assertCanonicalDocument(data)` — schema **plus** semantic checks; throws
  `InvalidDocumentError` with an `issues[]` detail. Semantic checks:
  `EMPTY_DOCUMENT`, `DUPLICATE_PAGE_NUMBER`, `CHUNK_PAGE_UNKNOWN` (chunk
  references a page that does not exist), `INVALID_BBOX` (non-finite,
  negative, or outside 0..1), `INVALID_SOURCE_HASH` (not 64-char hex),
  `TEXT_PAGES_MISMATCH` (warning only).

All shipped adapters validate their own output before returning. A document
that crosses a trust boundary (e.g. received from another service) SHOULD be
passed through `assertCanonicalDocument` by the receiving code.

## 2. Source identity contract (normative)

```
CanonicalDocument.id        ──┐  adapter-assigned identity
CanonicalDocument.sourceHash ─┤  sha256 of canonical text
Manifest.source.id      = CanonicalDocument.id        (set by the extractor)
Manifest.source.hash    = CanonicalDocument.sourceHash
Evidence.source_id      = Manifest.source.id          (per-Action check)
```

- `Evidence.source_id` must resolve back to the canonical source. The verifier
  enforces this per Action (`EVIDENCE_SOURCE_ID`, error severity).
- `Manifest.source.hash` vs `CanonicalDocument.sourceHash` is a
  **manifest-level fatal** check (`SOURCE_HASH_MISMATCH`): on mismatch no
  Action may be promoted or exported.
- Given the same document input, an adapter must produce the same
  `sourceHash` (deterministic).

### Hash target

`sourceHash = sha256hex(canonicalText(doc))` where `canonicalText` is
`doc.text` if non-empty, else `pages` (sorted by pageNumber) joined with
`\n`, else `chunks` joined with `\n`. Upstream hashes (e.g. Docling
`origin.binary_hash`) are preserved in `metadata.upstream_binary_hash` for
provenance only — they are never used as `sourceHash`.

## 3. Adapter contract

```ts
interface DocumentAdapter {
  readonly id: string;
  canHandle(input: AdapterInput): boolean;
  toCanonical(input: AdapterInput): Promise<CanonicalDocument>;
}
```

Responsibilities: **parse and normalize only.** An adapter MUST NOT extract
Actions — `DoclingAdapter → CanonicalDocument → ActionExtractor`, never
`DoclingAdapter → Action`. This keeps every Action traceable to canonical
Evidence and keeps parsers swappable (constitution: documents are
replaceable).

An adapter MUST:

1. Produce output that passes `assertCanonicalDocument`.
2. Preserve source identity, page numbers, sections, and (when the coordinate
   system is known) bboxes.
3. Fail explicitly with a typed error; silent fallbacks (e.g. returning an
   empty document for a broken payload) are forbidden.

### Error model

All adapter errors extend `DocumentAdapterError` (so existing
`instanceof DocumentAdapterError` handlers keep working) and carry a stable
`code`:

| Class | `code` | When |
| --- | --- | --- |
| `UnsupportedInputError` | `UNSUPPORTED_INPUT` | Input kind the adapter cannot handle. |
| `MalformedAdapterPayloadError` | `MALFORMED_ADAPTER_PAYLOAD` | Payload is structurally broken (wrong types, non-array `texts`, …). |
| `MissingSourceIdError` | `MISSING_SOURCE_ID` | Neither `input.id` nor a payload name provides source identity. |
| `InvalidPageError` | `INVALID_PAGE` | Bad `page_no`, or provenance references an undeclared page. |
| `InvalidBoundingBoxError` | `INVALID_BBOX` | Non-numeric or inverted bbox. |
| `InvalidDocumentError` | `INVALID_DOCUMENT` | The resulting document violates the contract (e.g. `EMPTY_DOCUMENT`, `DUPLICATE_PAGE_NUMBER`). |
| `NotImplementedError` | `NOT_IMPLEMENTED` | Live binary conversion (run the parser upstream instead). |

## 4. Docling mapping (reference adapter)

Docling is a Python ecosystem tool and stays **outside** ActionManifest: run
Docling upstream, pass `DoclingDocument.export_to_dict()` JSON to
`@actionmanifest/adapters`. No Python runtime, no subprocess, no network in
CI. A future Python SDK may wrap the same contract; it is out of Phase 2
scope.

| Docling JSON | CanonicalDocument |
| --- | --- |
| `name` (or `input.id`) | `id` |
| `origin.mimetype` | `mediaType` |
| `origin.binary_hash` | `metadata.upstream_binary_hash` (provenance only) |
| `texts[].text` / `.orig` | chunk `text`; page text composition |
| `texts[].prov[0].page_no` | chunk `pageNumber` (1-based) |
| `texts[].prov[0].bbox` (`l/t/r/b`, `coord_origin`) | chunk `bbox`, normalized 0..1 (TOPLEFT and BOTTOMLEFT supported) |
| `texts[].label` = `title` / `section_header` | sets `section` context for itself and following chunks |
| `texts[].self_ref` | chunk `sourceReference` |
| `pages` (dict keyed by page no., `size.width/height`) | `pages[]`; page size enables bbox normalization |

Multi-provenance items use `prov[0]` (first provenance wins; the rest are
ignored in Phase 2). bbox is omitted, with a `metadata.warnings` entry, when
`coord_origin` is unknown or the page size is missing.

The Phase 1 fixture shorthand (`pages` as an array, `texts[].page_no`)
remains accepted via the same adapter and `mapDoclingFixture`.

## 5. Evidence provenance end to end

```
Action → Evidence { source_id, text, page?, bbox?, section?, source_reference? }
```

The deterministic extractor resolves each evidence quote through
`locateEvidence(doc, quote)` (chunk → page), so page/bbox/section survive
from the adapter all the way into the manifest. Quotes that cannot be located
omit locators rather than inventing them. The verifier checks that declared
pages exist (`INVALID_PAGE_REF`) and that quotes appear in the canonical text
(`EVIDENCE_NOT_IN_SOURCE`).

Headings are structure, not Actions: a sentence that *is* a heading (its
located chunk's `section` equals the sentence) is skipped by the
deterministic extractor.

## 6. Consuming verified Actions (reference consumer)

`@actionmanifest/consumer` is the reference policy. Do **not** consume on
`status === "verified"` alone, and do not read only the aggregate booleans:
use the per-Action receipt (`receipt.verification.actions[]`) together with
manifest-level fatal detection.

```ts
import { classifyManifest } from "@actionmanifest/consumer";

const report = classifyManifest(verifiedManifest);
for (const { action, disposition, reasons } of report.actions) {
  // disposition: "ready" | "review_required" | "blocked"
}
```

| Disposition | Meaning |
| --- | --- |
| `ready` | Per-Action verification passed, status is verified-tier (`verified`/`accepted`/`exported`), no manifest-level fatal. Safe to consume. |
| `review_required` | Trust cannot be established from the receipt (no verification run, v0.1 aggregate-only receipt with failures, or passed-but-not-promoted). Human review first. |
| `blocked` | Per-Action verification failed, the Action was rejected, or a manifest-level fatal poisons the document. Never consume. |

A **manifest-level fatal** (`source_hash_matched: false`, or `EMPTY_SOURCE`)
blocks **every** Action, including ones whose per-Action checks passed.

## 7. Export policy

```ts
exportIcs(manifest);                          // verified-only (default)
exportIcs(manifest, { include: "all" });      // explicit opt-in
exportJson(manifest);                         // verified-only actions + full receipt
exportJson(manifest, { include: "all" });     // full audit record
```

- Default is **verified-only** (`verified` / `accepted` / `exported`).
  Unverified Actions never enter an export silently.
- `include: "all"` is the explicit opt-in. ICS entries from unverified
  Actions are marked `X-ACTIONMANIFEST-STATUS:<status>`. JSON always keeps
  the verification receipt, so omitted Actions remain explainable.
- A manifest-level fatal receipt throws `ExportError` (`EXPORT_BLOCKED`) from
  both exporters: no executable output from an untrustworthy document.
- Temporal safety: `approximate` temporals never produce calendar dates;
  `conditional` alternatives (e.g. rain dates) stay alternatives (ICS
  `COMMENT`), never the primary `DTSTART`; undated relative temporals
  (`当日`) produce no VTODO.

## 8. Public packages

| Package | Import | Purpose |
| --- | --- | --- |
| `@actionmanifest/schema` | types, `actionManifestSchemasByVersion`, `canonicalDocumentSchema` | Immutable versioned JSON Schemas + TS types |
| `@actionmanifest/core` | `validateActionManifest`, `assertCanonicalDocument`, `checkCanonicalDocument`, `locateEvidence`, `ensureSourceHash`, `manifestFatalReasons`, errors | Canonical model, validation, hashing |
| `@actionmanifest/adapters` | `PlainTextAdapter`, `DoclingAdapter`, `mapDoclingDocument`, `resolveAdapter` | Document boundary |
| `@actionmanifest/extractor` | `extractActions`, `ActionExtractor`, providers | Candidate manifest extraction |
| `@actionmanifest/verifier` | `verifyManifest`, `verificationPassed`, `actionVerificationPassed` | Deterministic per-Action verification |
| `@actionmanifest/consumer` | `classifyManifest`, `readyActions` | Reference consumer policy |
| `@actionmanifest/exporters` | `exportJson`, `exportIcs`, `formatSummary` | File exporters (never execution APIs) |

Only the `"."` entry point (plus declared schema asset subpaths on
`@actionmanifest/schema`) is public. Deep imports are blocked by each
package's `exports` map and are covered by an integration test.

**Runtime support:** Node.js **>= 20** (`engines`), developed and tested on
Node 22. Everything is deterministic and offline; no package performs
network I/O at import or in the default pipeline (the optional
OpenAI-compatible provider is the documented exception).

## 9. Future consumers (out of scope here)

```
Otayori Vision/OCR or a future document parser
        ↓  Otayori Adapter (lives in Otayori, not here)
CanonicalDocument → ActionManifest → verified Actions → Otayori workflow
```

Product concepts (child/family/school IDs, notifications, subscriptions,
family calendar UI, parent profiles) never enter this repository — see
[OTAYORI-BOUNDARY.md](OTAYORI-BOUNDARY.md). Marker, Kreuzberg, email, and
speech parsers can implement the same `DocumentAdapter` contract.
