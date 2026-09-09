# Adapter author guide

How to connect a new document parser (Marker, Kreuzberg, an OCR engine, an
email parser, …) to ActionManifest. The contract is small on purpose; the
safety rules are not negotiable.

## The one rule

**Adapters parse and normalize. They never infer Actions.**

```
Your parser  →  YOUR adapter  →  CanonicalDocument  →  ActionManifest Core
```

If your adapter emits Actions, deadlines, or "events" directly, it is
bypassing Evidence — the verifier can no longer check anything. Don't.

## Checklist

1. **Stable source identity.** `CanonicalDocument.id` comes from the caller
   or the real source (file name, message id), never from your parser's
   internal result/element ids. The chain `CanonicalDocument.id →
   Manifest.source.id → Evidence.source_id` must resolve back to the actual
   document.
2. **Deterministic hash.** `sourceHash = sha256(canonicalText(doc))` via
   `ensureSourceHash()`. Same input → same hash. Upstream hashes go to
   `metadata.upstream_*`, never into `sourceHash`.
3. **Unknown stays unknown.** No invented pages (`page: 1` for a format
   without pages), no invented bboxes, no invented text. Omit the field.
4. **bbox only when safe.** Map coordinates into the canonical convention
   (normalized 0..1, page-relative, top-left origin) ONLY when you know the
   source coordinate system AND the page width AND the page height AND the
   origin. Otherwise omit (see the Xberg adapter).
5. **Validate your own output.** Return `assertCanonicalDocument(...)`'s
   result. External input is not trusted.
6. **Fail closed with typed errors.** Reuse the shared taxonomy
   (`MALFORMED_ADAPTER_PAYLOAD`, `MISSING_SOURCE_ID`, `INVALID_DOCUMENT`,
   `INVALID_PAGE`, `INVALID_BBOX`, `UNSUPPORTED_INPUT`, `MULTIPLE_DOCUMENTS`).
   Never return an empty or partial document for broken input.
7. **No network by default.** If your parser can fetch URLs, require an
   explicit caller opt-in (e.g. `allowRemote: true`).
8. **Keep heavy/native dependencies isolated.** Put them in their own
   package (like `@actionmanifest/adapter-xberg`) so Core consumers never
   install them. Prefer a pure mapping layer (serialized result →
   CanonicalDocument) separated from the runtime bridge.

## Testing your adapter

Minimum test set (see `packages/adapters/src/docling.test.ts` and
`packages/adapter-xberg/src/mapper.test.ts` for reference):

- valid minimal input, valid rich input
- malformed payload / wrong types
- empty content → `INVALID_DOCUMENT`
- missing source id → `MISSING_SOURCE_ID`
- multi-document payload → `MULTIPLE_DOCUMENTS` (or explicit split API)
- deterministic mapping (same input → same hash)
- provenance preservation (whatever your parser genuinely has)
- bbox omission when the coordinate contract cannot be satisfied

Then prove parser independence: run your fixture and the Docling fixture for
the same logical document through extract → verify → consume → export and
compare the semantic projections (see
`integration/reference-consumer/test/cross-parser.test.ts`).

## Conformance

Adapter packages are NOT part of the universal conformance suite — universal
conformance covers the contract itself (schema, canonical document, evidence,
trust, temporal, ics). Adapter tests live with the adapter and in
`integration/`. Do not add parser-specific vectors to `conformance/vectors/`.
