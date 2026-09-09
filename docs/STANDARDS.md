# Standards

How ActionManifest maps to external standards, and where it deliberately
deviates. Three layers are kept distinct throughout:

- **RFC requirement** — what the external standard itself mandates.
- **ActionManifest normative requirement** — our contract (RFC 2119/8174
  MUST/SHOULD/MAY), defined in SPECIFICATION.md and INTEGRATION-CONTRACT.md.
- **Reference implementation behavior** — what this TypeScript implementation
  currently does (verified by the conformance suite).

## Referenced specifications

| Specification | Role |
| --- | --- |
| RFC 5545 (iCalendar) | ICS export format (VEVENT/VTODO subset) |
| RFC 8259 (JSON) | Manifest / CanonicalDocument / vector serialization |
| JSON Schema Draft 2020-12 | Manifest + CanonicalDocument contracts |
| RFC 2119 / RFC 8174 | Normative vocabulary in our docs |

## iCalendar (RFC 5545) mapping

ActionManifest is **not** a calendar library. The exporter emits a deliberate
subset of iCalendar, sufficient for "verified Action → calendar entry / task".

| RFC 5545 requirement | ActionManifest behavior |
| --- | --- |
| §3.1 content lines delimited by CRLF | MUST. Emitted streams use CRLF exclusively (byte-level tested). |
| §3.1 lines SHOULD NOT exceed 75 **octets** | MUST. Folding is UTF-8 octet-aware: every physical line ≤ 75 octets, continuation lines start with one SPACE (counted), multi-byte sequences are never split. `unfold(fold(x)) === x`. |
| §3.3.13 TEXT escaping (BACKSLASH, COMMA, SEMICOLON, newline) | MUST. `\` `,` `;` escaped; CR, LF, CRLF all become escaped `\n`, so user-derived text cannot inject content lines (property-injection tested). Non-representable C0/C1 control characters are stripped; TAB (legal WSP) is preserved. |
| §3.8.4.7 UID globally unique | MUST. `UID = sha256hex(source.id + ":" + action.id)@actionmanifest` — opaque (raw source id never leaks), deterministic, collision-free across documents. Note: at 78 octets the UID line folds; readers MUST unfold per §3.1. |
| §3.8.7.2 DTSTAMP | MUST be present; UTC `YYYYMMDDTHHMMSSZ`. The reference implementation injects a clock (`options.now`) for determinism; default is the current time. |
| §3.8.2.1/§3.8.2.3 DATE values | MUST be real `YYYYMMDD`. Only schema-valid `YYYY-MM-DD` dates that exist in the proleptic Gregorian calendar are emitted (leap-day aware). Impossible dates (`2026-13-40`, `2026-02-31`) produce no artifact. |

### ActionManifest normative rules on top of RFC 5545

- Only `exact`/`range` temporals with a real calendar date become
  `DTSTART`/`DUE`. `approximate`, unresolved `relative`, and top-level
  `conditional` temporals MUST NOT produce an executable date — and MUST NOT
  produce a VEVENT/VTODO at all when no unconditional primary date exists.
- A dated `conditional` alternative MUST be preserved only as a `COMMENT`
  (`alternative <date> if <condition>`) on the primary artifact.
- Default export is trust-qualified (`evaluateActionTrust` ready only).
  `include: "all"` entries MUST carry `X-ACTIONMANIFEST-STATUS` and
  `X-ACTIONMANIFEST-DISPOSITION` (non-standard X-properties, §3.8.8.2).

### Known deviations / unsupported subset

| Feature | Status | Reason |
| --- | --- | --- |
| RRULE / recurrence engine | Unsupported | `recurring` temporals are preserved in the manifest but never expanded into RRULE. Out of scope (no recurrence engine). |
| VTIMEZONE / TZID | Unsupported | Dates are exported as floating `VALUE=DATE`. `datetime`/`timezone` fields exist in the schema but are not yet exported. Phase 2.x candidate. |
| VALARM, ATTENDEE, ORGANIZER | Unsupported | ActionManifest models obligations, not meetings. |
| CalDAV / scheduling protocol | Unsupported | Extraction is not execution; we emit files only. |
| Multi-VALARM / rich DESCRIPTION markup | Unsupported | DESCRIPTION is plain escaped TEXT (evidence quotes + conditions, ≤ 500 code points). |
| UID folding | RFC-legal | UID lines may fold at 75 octets; conforming readers unfold. |

## JSON (RFC 8259)

Manifests, CanonicalDocuments, and conformance vectors are RFC 8259 JSON
documents, UTF-8 encoded. No JSON5, no comments, no trailing commas.

## JSON Schema (Draft 2020-12)

- Every published schema declares
  `"$schema": "https://json-schema.org/draft/2020-12/schema"`.
- All `$ref`s are internal (`#/$defs/…`) — validation is fully offline; no
  remote schema fetch at runtime or in CI.
- `additionalProperties: false` on all objects: unknown fields are rejected.
- `ActionKind` / `Modality` are extensible enums (`anyOf`: known enum +
  `^x-…` pattern); `ReviewStatus`, `TemporalType`, `ActorCertainty`,
  `Inference` are closed enums by design (a parser must not invent lifecycle
  or temporal semantics).
- `temporal.date` uses `format: "date"` (RFC 3339 full-date) — asserted with
  `ajv-formats` in the reference implementation.
- Version dispatch: `schema_version` selects exactly one frozen schema
  (`const "0.1.0"` / `const "0.2.0"`); unknown versions are rejected.

### Frozen schema integrity

Immutable means governance-enforced, not checksum-self-declared. Two layers:

1. **Checksum pins** (`packages/schema/schemas/checksums.json`): sha256 of
   the frozen v0.1/v0.2 manifest schemas, checked by `pnpm schema:validate`.
   Detects working-tree corruption and anchors release artifact integrity —
   but on its own could be "updated" to bless a change, so it is NOT the
   immutability enforcement.
2. **Git-diff frozen-path guard** (`pnpm governance:validate`, required in
   CI): any diff touching `packages/schema/schemas/v0.1/**` or `v0.2/**`
   fails, regardless of what happened to checksums.json. Schema changes MUST
   ship as a new `schema_version`.

The CanonicalDocument schema is intentionally **not** frozen: it is the
unversioned integration boundary and evolves additively (see
COMPATIBILITY.md).

### Universal ICS conformance is semantic

For conformance purposes (see CONFORMANCE.md), calendar output is compared
**semantically**: component types and their normative properties (UID,
DTSTART/DUE, SUMMARY, COMMENT, trust markers) must match, while property
ordering, PRODID value, legal fold positions, DTSTAMP lexical details, and
additional X-* properties are implementation freedom. Byte-exact output is a
separate TypeScript reference-serialization regression gate.

## Normative language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, MAY in
SPECIFICATION.md, INTEGRATION-CONTRACT.md, COMPATIBILITY.md, and
CONFORMANCE.md are to be interpreted as described in RFC 2119 / RFC 8174.
