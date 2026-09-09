# ADR 0006 — Phase 2.2: Parser independence & Xberg reference adapter

Status: Accepted
Date: 2026-09-09
Builds on: ADR 0004 (integration contract), ADR 0005 (standards/conformance)

## Context

Phase 2 established `CanonicalDocument` as the interoperability boundary with
one structured parser (Docling) plus plain text. A single structured adapter
cannot prove the boundary is parser-independent — the contract could have
silently absorbed Docling-specific assumptions. Phase 2.2 adds a second,
architecturally different parser to prove "documents are replaceable" at the
implementation level.

## Decision

### 1. Xberg as the second parser

Xberg (`@xberg-io/xberg` 1.1.3) is a native (Rust/napi) document intelligence
library with a fundamentally different result model (unified `content` +
optional `elements[]` / `pages[]` / `tables[]`) from Docling's
`texts[]`+`prov[]` graph. The API shape was verified from the **installed
package's type definitions**, not documentation: `extract(ExtractInput,
ExtractionConfig) → ExtractionResult{ results: ExtractedDocument[], errors }`.

### 2. Native dependency containment: separate package

Xberg ships platform-specific native binaries via `optionalDependencies`.
Forcing that onto every ActionManifest consumer would violate the trust order
(install isolation, CI portability, browser/edge safety). The adapter lives
in `@actionmanifest/adapter-xberg`:

- **Direct dependency** on `@xberg-io/xberg` (not peer/optional): Layer B
  cannot function without it, and choosing this package IS the opt-in.
  Xberg's own optionalDependencies handle platform resolution.
- **Dynamic import** in the runtime bridge: consumers using only the pure
  mapper never load the native binding.
- **pack:check enforces containment**: any `@xberg-io/*` dependency in a
  non-adapter package fails the build.
- Node `>=22` only for this package (Xberg's engine requirement); all other
  packages stay `>=20`.

### 3. Two-layer adapter design

- **Layer A — `mapXbergResultToCanonical(payload, { sourceId })`**: pure,
  structurally validated mapping of a serialized `ExtractionResult`. No
  Xberg types, no runtime, no network. Third parties who already ran Xberg
  use this directly.
- **Layer B — `XbergAdapter`**: the only code that knows the Xberg runtime
  (`extract()`), wired to the shared `DocumentAdapter` contract via the new
  `xberg-uri` / `xberg-bytes` / `xberg-result` input kinds.

### 4. Provenance without invention

- Source identity is caller-supplied (`sourceId`); Xberg element/result ids
  are locators (`sourceReference`), never document identity.
- Pages map only when upstream provides per-page content; markdown/text
  results get NO synthetic page 1.
- Sections come from `title`/`heading` elements (same convention as Docling).
- **bbox is omitted**: Xberg coordinates have no documented coordinate system
  or page dimensions, so the canonical 0..1 normalization cannot be satisfied
  safely. Unknown stays unknown.
- Multi-document results (archives) are rejected (`MULTIPLE_DOCUMENTS`) —
  never silently concatenated.

### 5. Evidence: semantic equivalence, not byte equality

The cross-parser test compares semantic projections (Action kind/modality/
dates/alternatives, trust dispositions, executable calendar dates) between
the Docling and Xberg paths for the same logical notice. CanonicalDocuments
may differ in chunking/whitespace/metadata; divergence in Action semantics
would be critical. Result: critical parser divergence = 0.

### 6. Conformance suite untouched

Adapter compatibility is not universal conformance. No normative vectors
changed; suite stays 0.2.0; the frozen schemas are untouched (governance
guard passes).

## Consequences

- ActionManifest no longer depends on any single parser's semantics; the
  adapter boundary is proven with two architecturally different engines.
- A documented pattern (ADAPTER-AUTHOR-GUIDE.md) exists for Marker /
  Kreuzberg / OCR / email / Otayori adapters.
- Consumers who don't need Xberg pay zero cost (separate package, dynamic
  import, no native install).
- Live native tests are opt-in (`pnpm xberg:integration`) to keep CI
  deterministic and portable; pure mapping tests gate CI.
