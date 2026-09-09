# ADR 0004 — Phase 2: Integration contract & reference adapter

Status: Accepted
Date: 2026-09-09
Builds on: ADR 0001 (architecture), ADR 0002 (per-Action verification)

## Context

Phase 1.x proved the pipeline works inside this repository: plain-text input,
deterministic extraction, per-Action verification, adversarial benchmark with
`critical false-verified = 0`. But everything consumed in-repo fixtures and
in-repo imports. Phase 2 makes ActionManifest usable by **third-party code**:
external document parsers (Docling today; Marker, Kreuzberg, OCR, email,
speech, Otayori tomorrow) and external applications consuming verified
Actions.

## Decision

### 1. CanonicalDocument is the interoperability boundary

External parsers never touch Core types other than `CanonicalDocument`, and
Core never sees parser-native structures (PDF bytes, Docling provenance, OCR
tokens). The boundary is formalized as a contract:

- Semantic validation (`assertCanonicalDocument`) runs at the boundary:
  empty content, duplicate pages, orphan chunk page refs, malformed source
  hash, and out-of-convention bboxes are hard errors; text/pages mismatch is
  a warning. Adapters validate their own output; receivers validate documents
  crossing a trust boundary.
- Source identity is pinned: `Manifest.source.id = CanonicalDocument.id`,
  `Manifest.source.hash = CanonicalDocument.sourceHash`,
  `Evidence.source_id = Manifest.source.id` (verifier-enforced per Action).
- `sourceHash` is always `sha256` of the canonical text, computed on our side.
  Upstream hashes (Docling `origin.binary_hash`) are provenance metadata only.

### 2. bbox convention: normalized 0..1, top-left origin

Canonical `BoundingBox {x, y, width, height}` is normalized to 0..1 relative
to the page, origin top-left. Adapters convert only when the input coordinate
system (Docling `coord_origin`) **and** the page size are known; otherwise
they omit the bbox and record a `metadata.warnings` entry. We never store
absolute pixels/points as if normalized, and never guess a normalization.

This is a clarification, not a breaking change: no Phase 1 adapter ever
emitted a bbox, the verifier does not geometrically check bboxes, and the
JSON Schema gains only an annotation. **Phase 2.x candidate:** if a future
parser legitimately needs absolute coordinates, add an explicit
coordinate-system field rather than overloading the convention.

### 3. Docling is an adapter, not Core

Docling (Python) runs upstream and emits JSON; `@actionmanifest/adapters`
converts that JSON into a CanonicalDocument. The TypeScript core has no
Python dependency, no subprocess, no network requirement; CI exercises the
adapter against synthetic JSON fixtures only (deterministic, offline). A
Python SDK wrapping the same contract is a documented future option, not
Phase 2 scope. The adapter never extracts Actions — parse/normalize only —
so parser code can never bypass Evidence.

### 4. Verified-only is the default consumer/export policy

Extraction is not execution. The closest we get to execution is export, so
exports default to `verified-only`; `include: "all"` is an explicit opt-in. A
manifest-level fatal receipt (source hash mismatch, empty source) makes both
exporters throw `ExportError` — no executable output from an untrustworthy
document.

`@actionmanifest/consumer` is the reference consumer policy:
`ready / review_required / blocked` derived from the per-Action receipt plus
fatal detection — never from `status` alone, never from aggregate booleans
alone. A fatal receipt blocks every Action; a per-Action failure blocks only
that Action (Phase 1.1 trust semantics preserved).

**Pre-merge hardening (PR #4 review):** the first cut of the export policy
filtered on lifecycle status only, which diverged from the consumer whenever
status and receipt contradicted each other (`status=verified` + failed
per-Action receipt, verified status with no receipt, passed-but-`proposed`).
Export is consumption, so the trust predicate is now shared:
`evaluateActionTrust()` in core is the single source of truth used by both
the consumer (classification) and the exporters (filtering). Under
`include: "all"`, every ICS entry carries both `X-ACTIONMANIFEST-STATUS` and
`X-ACTIONMANIFEST-DISPOSITION`, so a `verified` label can never mask a failed
receipt. Trust order: receipt truth > lifecycle status > export convenience.

### 4b. Conditional temporals are not executable dates

A top-level `conditional` temporal (e.g. a rain date) holds only when its
condition holds, so it must never become `DTSTART`/`DUE` — and when no
unconditional primary date exists, no VEVENT/VTODO is produced at all.
Conditional `alternatives[]` never become primary; they are preserved as
`COMMENT` annotations on the primary artifact. `approximate`/undated
`relative` temporals remain non-executable (unknown stays unknown).

### 4c. ICS UID derivation: opaque, globally stable

Action ids are manifest-local, so `UID:act_001@actionmanifest` collides
across documents. UIDs are now
`sha256hex(source.id + ":" + action.id)@actionmanifest`:

- **source.id + action.id**, not source.hash + action.id: calendar update
  semantics favor logical document identity. A content revision of the same
  document should update the existing calendar entry in place; keying on the
  content hash would orphan the old entry on every edit.
- **Opaque by construction**: source ids can embed sensitive filenames
  (`student-name-school-2026.pdf`), so the raw id never appears — only the
  digest.

### 5. Packaging: prove third-party consumption

`integration/reference-consumer` is a private package that imports only
public entry points, resolved against **built dist** via package.json
`exports` (no source aliases). It hosts the round-trip tests (A–F) and the
Integration Golden E2E. `pnpm pack:check` packs every public package offline,
asserts tarball contents (dist, d.ts, schema assets, no src/tests, no
`workspace:` refs), and runtime-smokes the extracted tarballs. Nothing is
published.

### 6. Evidence provenance is wired through the extractor

The deterministic extractor resolves each evidence quote via
`locateEvidence()` (chunk → page) instead of hardcoding page 1, and skips
sentences that *are* document headings (located chunk `section` equals the
sentence). Plain-text flow carries no sections, so the 74-fixture benchmark
is byte-identical in behavior; multi-page documents gain correct page/bbox
provenance. Unlocatable quotes omit locators (unknown stays unknown).

## Consequences

- Third parties integrate through a documented, validated, semver-typed
  boundary with a stable error taxonomy (`UNSUPPORTED_INPUT`,
  `MALFORMED_ADAPTER_PAYLOAD`, `MISSING_SOURCE_ID`, `INVALID_PAGE`,
  `INVALID_BBOX`, `INVALID_DOCUMENT`, `EXPORT_BLOCKED`).
- Evidence keeps page/bbox/section/sourceReference from parser to manifest to
  consumer.
- Unverified Actions cannot silently become calendar entries.
- The adversarial benchmark is unchanged: 74 fixtures, critical
  false-verified = 0.
- New failure mode to monitor: adapters that omit bboxes (unknown geometry)
  produce Evidence without geometry — consumers must tolerate absent bbox.
