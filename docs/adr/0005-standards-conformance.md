# ADR 0005 — Phase 2.1: Standards & conformance hardening

Status: Accepted
Date: 2026-09-09
Builds on: ADR 0001 (architecture), ADR 0002 (per-Action verification), ADR 0004 (integration contract)

## Context

Through Phase 2, ActionManifest proved the TypeScript implementation works and
is safe. But "works" was only verifiable by running this repository's tests.
For ActionManifest to be an OSS *specification* — implementable in Python,
Rust, or Go and verifiable as "ActionManifest conformant" — the contract must
exist independently of the reference implementation, and the iCalendar output
must actually conform to RFC 5545 at the byte level.

Review found the ICS serializer folded content lines by JavaScript **character
count**, not **octets** (RFC 5545 §3.1). A 74-character Japanese line is 222
UTF-8 octets — three times the limit — so every Japanese calendar entry was
technically non-conformant.

## Decision

### 1. RFC 5545 byte-level conformance

- Content-line folding is UTF-8 **octet-aware**: every physical line ≤ 75
  octets (CRLF excluded), continuation lines start with one SPACE (counted),
  multi-byte sequences are never split, and `unfold(fold(x)) === x`.
  Property-based tests cover 500 deterministic pseudo-random Unicode strings
  (ASCII, kana, CJK, emoji, combining marks, full-width forms).
- TEXT escaping neutralizes CR, LF, and CRLF into the escaped `\n` sequence —
  user-derived titles cannot inject content lines (tested with a hostile
  `BEGIN:VEVENT`/`DTSTART:2099` payload). C0/C1 control characters are
  stripped; TAB is legal WSP and preserved.
- Only real Gregorian calendar dates (`YYYY-MM-DD`, leap-day aware) become
  `DTSTART`/`DUE` — the exporter is a trust boundary even for schema-valid
  manifests produced by broken third parties.
- `DTSTAMP` accepts an injected clock (`options.now`), making ICS output
  byte-deterministic for conformance vectors. Default remains wall clock.
- UID folding: the 78-octet UID folds per §3.1; that is RFC-legal and
  documented as a known deviation note (readers MUST unfold). We keep the
  full sha256 hex rather than truncating, to preserve the Phase 2 UID
  contract byte-for-byte.

### 2. Conformance is defined by vectors, not by the implementation

`conformance/vectors/` holds 65 hand-written, language-neutral JSON vectors
across six profiles (schema, canonical-document, evidence, trust, temporal,
ics), including byte-exact ICS goldens under a fixed clock. The reference
runner uses only public package APIs; third parties MAY write their own
runners. Expected values are normative and spec-derived — implementation
output is never the oracle (same integrity rule as the adversarial
benchmark).

### 3. Three version axes are independent

Manifest schema version (`0.2.0`), npm package versions (`0.x.y`), and the
conformance suite version (`0.1.0`) evolve independently; rules are in
`docs/COMPATIBILITY.md`. Frozen schemas are pinned by sha256 in CI; changes
require a new `schema_version`.

### 4. New safety invariant: critical false exported = 0

Beyond per-vector results, the suite enforces that no `blocked` /
`review_required` Action ever reaches the default executable export. This is
the export-side analogue of the benchmark's critical false-verified = 0.

## Post-review hardening (PR #5 final governance)

Three review blockers were fixed after the initial Phase 2.1 review:

### 5. Universal conformance ≠ reference serialization

The first cut put byte-exact `.ics` goldens inside the `ics` profile, which
would have required third-party implementations to reproduce our serializer
byte-for-byte — property order, PRODID, fold positions included. RFC 5545
explicitly allows those differences. The suite is now split:

- **Universal profiles** (`schema`, `canonical-document`, `evidence`,
  `trust`, `temporal`, `ics`) check semantics only. ICS vectors compare
  parsed component/property sets via a minimal semantic reader
  (`ics-semantic.ts`), never raw bytes.
- **`reference-serialization`** keeps the byte-exact goldens as a
  TypeScript-only regression gate (`pnpm conformance:reference`). It never
  affects the universal result.

Reference implementation is not the specification.

### 6. Vector meta-schemas (normative test data is code)

Vectors were previously trusted as raw JSON — a typo'd expectation field
(`not_contians`) would have been silently ignored, letting implementations
"pass" a vector that checks nothing. Every vector and the suite manifest are
now validated against Draft 2020-12 meta-schemas (`conformance/schema/`)
before execution; malformed vectors are runner/config errors (exit 2). The
meta-schemas are part of the language-neutral contract — third parties can
validate vectors without TypeScript types.

### 7. Governance-enforced immutability and suite versioning

Checksum pins alone are self-declared: editing `checksums.json` could bless a
frozen-schema edit. Two CI guards now close this:

- **Frozen-path guard**: any diff touching `packages/schema/schemas/v0.1/**`
  or `v0.2/**` fails, regardless of checksum updates. (Checksums remain for
  corruption detection and release integrity.)
- **Suite version guard**: normative conformance contents changed +
  unchanged `suite_version` → CI fails. Reference-serialization goldens are
  exempt (they track the TypeScript implementation, not the contract).

Suite version bumped 0.1.0 → 0.2.0 for this structure change (profile split +
meta-schemas), per the revised bump policy in COMPATIBILITY.md (patch =
editorial only; minor = new normative vectors/profiles; major = changed
existing expectations).

## Consequences

- "ActionManifest conformant" is now decidable for any implementation:
  run the official vectors, get CONFORMANT/NON-CONFORMANT — without
  reproducing our serializer byte-for-byte.
- ICS output is RFC 5545-conformant at the byte level for Japanese/emoji/
  mixed content.
- Schema immutability is governance-enforced (git-diff guard) with checksums
  as a secondary corruption detector.
- The suite is offline and deterministic: no network, no wall clock, no
  Python/Docling runtime.
- Known deviations (no RRULE, no VTIMEZONE, no CalDAV) are documented in
  STANDARDS.md rather than implied.
- Phase 2.1 explicitly does NOT cut schema v1.0; this is the conformance
  foundation a future v1.0 will be judged against.
