# Local document questions (v7 source candidate)

ActionManifest can now answer bounded questions by returning exact original source
passages and adjacent context. This is local extractive retrieval, not a general
semantic AI, an accuracy guarantee, or a permission to execute an action.

## Useful questions

- `deadline`: source lines mentioning a deadline, due date or submission date.
- `cost`: source lines mentioning cost, payment or currency.
- `requirements`: source lines mentioning required items, submission or steps.
- `contact`: source lines mentioning contacts, email or phone.
- `table`: tab/pipe/comma-delimited source rows. Column relationships, merged
  cells and cross-row conditions are never inferred.
- `search`: normalized literal/token subject search.

Use a short `text` subject such as `遠足` or `registration`, optionally with a
question kind. Full natural-language questions are not semantically interpreted.
Patterns cover common Japanese and English cues; other wording can be missed.
`not_found` means no indexed match, never proof that the fact does not exist.
Multiple numeric values are exposed as `valueVariants` for comparison; they may
be different subjects, choices or revisions, not necessarily contradictions.
No deadline, cost or obligation is selected as authoritative automatically.

## Library API

```ts
import { createDocumentEvidenceIndex, verifyDocumentCitation } from "@actionmanifest/core";

const document = {
  id: "notice-42",
  text: "遠足の参加費は１，５００円です。\n雨天中止時のみ返金します。",
};
const index = createDocumentEvidenceIndex(document); // retain for repeated queries
const answer = index.query({ kind: "cost", text: "遠足", limit: 8 });
for (const citation of answer.evidence) {
  if (!verifyDocumentCitation(document, citation)) throw new Error("stale evidence");
  const context = index.explainCitation(citation, 1); // adjacent original lines
  console.log({ citation, context });
}
```

The immutable snapshot copies indexed passages. Editing caller input cannot
change existing results. Rebuild the index when source text/pages/chunks change;
compare `snapshotHash` before publishing asynchronous results. Hosts should run
large indexing off their UI thread and cancel/discard obsolete requests.
Optional AbortSignal is checked before work and between segments/candidates;
the synchronous JavaScript API does not yield the event loop itself.

Each citation has source ID, snapshot hash, original container, container index,
paragraph (nonempty source line number), half-open UTF-16 `start`/`end`, and exact
`quote`. Page numbers are included only when provided by the source. Offsets
always refer to the original container, never NFKC-normalized text. Fullwidth
Japanese, ASCII case and whitespace normalize for matching only. Exact phrase
matches rank ahead of token matches; token matches can be noncontiguous.

If explicit canonical text disagrees with page text, canonical text wins and page
locators are omitted with a warning. Chunk-only documents keep their chunk-local
provenance. A query snapshot hash is distinct from canonical sourceHash: it also
covers indexed page/chunk representations. No receipt or execution grant results.

## CLI

```sh
pnpm actionman ask-document notice.txt --kind cost --subject 遠足 --include-evidence
pnpm actionman ask-document canonical.json --canonical-json --kind deadline --include-evidence
```

Output is JSON on local stdout, including adjacent original context. The explicit
`--include-evidence` flag acknowledges source quotations in that output. Errors
are generic and do not echo document content. No server, credentials or paid model
is required. The canonical JSON route validates the canonical contract. Text
input is UTF-8; supplying binary PDF or Office files here is unsupported.

## Supported input boundary

- Built-in adapters: UTF-8 plain text, Markdown and CSV as text; parsed Docling JSON.
- Existing optional `adapter-xberg`: separate optional upstream parser integration,
  with its own installation and runtime requirements. It is not added by v7.
- PDF/OCR/Office/HTML: pass valid parsed canonical text/pages from an appropriate
  upstream adapter. This feature does not add binary parsers, OCR engines, HTML
  sanitization or universal format support.
- Images, unreadable scans, unsupported encodings, missing pages and OCR mistakes
  cannot be answered reliably. Check original documents for consequential facts.

## Limits and performance

No new dependency was added. There is no global cache or persistence. The caller
controls the lifetime of one source index and can release it when the document
closes. Indexes reuse normalized token postings for subsequent subject queries.

Hard limits: 2,000,000 indexed UTF-16 units, 8,000,000 units across all input strings
and keys (including metadata and duplicate representations), 100,000 total input
nodes, 16 levels of nesting, 20,000 items per input array, 20,000 passages, 1,000 units per source-line segment, 512 units
per subject, 1–50 returned matches, and context radius 0–3. Circular input, accessors, class instances and non-JSON values are rejected; optional undefined data properties from JavaScript adapters remain supported. Pass parsed JSON or plain data objects, not active runtime objects. Preflight budgets run before schema/hash traversal. Limits reject input or
report `hasMore`; they never silently claim a whole-document answer. Cross-line
and cross-segment facts can be missed. Context expansion remains inside a page
or original container.

Run `node --import tsx scripts/document-query-benchmark.ts` for synthetic results.
It reports 200 pages / 5,000 source lines, initial indexing, 500 repeated queries,
and rebuilding costs. These timings do not measure native iPhone UI, OCR/PDF,
network latency, semantic accuracy or peak memory.
