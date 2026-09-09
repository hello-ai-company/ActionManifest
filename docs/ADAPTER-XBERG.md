# Xberg adapter

`@actionmanifest/adapter-xberg` connects [Xberg](https://github.com/xberg-io/xberg)
(`@xberg-io/xberg`, verified against 1.1.3 installed package types) to
ActionManifest. It is the **second independent parser** after Docling — the
proof that `CanonicalDocument` is a parser-independent boundary.

```
Xberg (native engine, upstream)
        ↓  extract() → ExtractionResult
@actionmanifest/adapter-xberg
        ↓  parse / normalize ONLY
CanonicalDocument  →  ActionManifest Core
```

## Two layers

| Layer | API | Touches Xberg runtime? |
| --- | --- | --- |
| A — pure mapping | `mapXbergResultToCanonical(payload, { sourceId })` | No. Structural validation of a serialized `ExtractionResult`; no native binding, no network. |
| B — runtime bridge | `new XbergAdapter().toCanonical({ kind: "xberg-uri" | "xberg-bytes" | "xberg-result", ... })` | Yes, via dynamic `import("@xberg-io/xberg")` — mapper-only consumers never load native code. |

If you already ran Xberg yourself, use Layer A (or `kind: "xberg-result"`) —
you keep control of when/how the native engine runs.

## Dependency isolation

The Xberg native binding lives **only** in this package (direct dependency;
Xberg itself resolves platform binaries via its own `optionalDependencies`).
Core, schema, adapters, extractor, verifier, exporters, consumer carry zero
Xberg dependency — enforced by `pnpm pack:check` (fails if any `@xberg-io/*`
leaks into a non-adapter package). Consumers who don't need Xberg never
install it.

Requires Node >= 22 (Xberg's own `engines`; other ActionManifest packages
remain >= 20).

## Mapping contract

| Xberg (`ExtractedDocument`) | CanonicalDocument |
| --- | --- |
| caller-supplied `sourceId` | `id` (Xberg element/result ids are NEVER document identity) |
| `content` (or element texts joined) | `text` |
| `mimeType` | `mediaType` |
| `detectedLanguages[0]` / `metadata.language` | `language` |
| `metadata.title` / title element | `title` |
| `pages[]` (`pageNumber`, `content`) | `pages[]` — only when upstream provides per-page content |
| `elements[]` (`elementId`, `elementType`, `text`, `metadata.pageNumber`) | `chunks[]` — `sourceReference` = elementId; `title`/`heading` set `section` context |
| `extractionMethod`, `counts`, `qualityScore` | `metadata.upstream_*` |
| element `coordinates` / layout regions | **omitted** — see bbox rule |

`sourceHash` is always `sha256(canonicalText(doc))` — Xberg has no equivalent
hash input, so the canonical rule applies unchanged.

## What is deliberately NOT mapped

- **bbox**: Xberg `BoundingBox` (`x0/y0/x1/y1`) is in an unspecified document
  coordinate space with no page dimensions. The canonical bbox contract
  (normalized 0..1, page-relative, top-left origin) cannot be satisfied
  safely, so bboxes are omitted. Unknown stays unknown.
- **pages for non-page-addressable formats** (plain text, markdown): no
  synthetic page 1 is invented. Chunks carry no `pageNumber` either.
- **tables/images/formulas/formFields**: not needed for Action extraction;
  left out of the canonical form (available upstream if ever needed).
- **Xberg structured/LLM extraction**: never used. Action semantics are the
  ActionManifest extractor's job, not the parser's.

## Multi-document policy

One source input → one CanonicalDocument. An `ExtractionResult` with more
than one document (e.g. an archive) is rejected with `MULTIPLE_DOCUMENTS` —
never silently concatenated. Split archives upstream and map each document
with its own `sourceId`.

## Security boundary

- `xberg-uri` with an `http(s)` URL requires explicit `allowRemote: true`;
  the adapter never fetches the network on its own.
- Archive decompression, format sniffing, and file parsing safety are
  Xberg-upstream responsibilities (Xberg ships its own `security_limits`
  configuration); ActionManifest adds no sandbox of its own.
- CI and the default test suite never run the native binding; live runtime
  tests are opt-in (`pnpm xberg:integration`, local files/bytes only).

## Errors

Reuses the shared adapter taxonomy: `MISSING_SOURCE_ID`,
`MALFORMED_ADAPTER_PAYLOAD`, `INVALID_DOCUMENT` (empty), `UNSUPPORTED_INPUT`,
`MULTIPLE_DOCUMENTS`, plus `XBERG_RUNTIME` for upstream engine failures.
Fail closed: malformed results never become empty CanonicalDocuments.
