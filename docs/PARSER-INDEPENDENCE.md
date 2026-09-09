# Parser independence

> **Parser output is replaceable. Action semantics are not parser-specific.**

ActionManifest is a parser-independent Action interchange layer. Phase 2.2
proves it by running the same logical document through two independent
parsers and showing identical downstream semantics.

```
            ┌─ Plain Text  (@actionmanifest/adapters)
            ├─ Docling     (@actionmanifest/adapters)
Inputs ─────┼─ Xberg       (@actionmanifest/adapter-xberg)
            └─ Future parsers (Marker / OCR / email / speech / Otayori)
                  ↓  DocumentAdapter — parse / normalize ONLY
          CanonicalDocument   ← the one interoperability boundary
                  ↓
          ActionManifest Core (extract → verify → consume → export)
```

## The rule

Parser-specific structure (Docling `prov`, Xberg `elements`, OCR tokens,
email headers) never crosses into Core. Each adapter normalizes to
`CanonicalDocument`; everything downstream — extraction, per-Action
verification, trust policy, export — is parser-agnostic.

- Removing Docling does not weaken ActionManifest.
- Removing Xberg does not weaken ActionManifest.
- Adding a parser means writing one adapter (see ADAPTER-AUTHOR-GUIDE.md),
  not changing Core.

## Evidence: cross-parser equivalence

`integration/reference-consumer/test/cross-parser.test.ts` runs the same
synthetic school notice through the Docling and Xberg paths and asserts:

- identical **semantic Action projection** (kind / modality / dates /
  conditional alternatives),
- identical **trust dispositions** (all `ready`, zero blocked),
- identical **executable calendar semantics** (VEVENT 2026-10-15, VTODO
  2026-10-05, rain date 2026-10-22 as COMMENT only),
- **critical parser divergence = 0**.

CanonicalDocuments are NOT required to be byte-identical across parsers:
chunk boundaries, metadata, heading representation, and whitespace may
differ. Evidence provenance stays source-specific — Docling contributes
page + bbox, Xberg contributes section + element reference — and each side
verifies against its own canonical text.

## What "replaceable" requires of a parser

A parser is safely pluggable when its adapter can:

1. produce a contract-valid `CanonicalDocument` (`assertCanonicalDocument`),
2. supply stable caller-controlled source identity,
3. preserve whatever provenance it genuinely has (page / section / locator),
4. omit what it does not know (no invented pages, bboxes, or text),
5. fail explicitly on malformed input.

If a parser cannot meet (1)–(5) for a given input, the adapter must reject
that input rather than degrade silently.
