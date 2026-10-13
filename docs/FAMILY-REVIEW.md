# v8 family evidence review (local source candidate)

Use `createDocumentEvidenceIndex(document).familyReview()` or
`actionman review-family notice.txt --include-evidence` to inspect family-related
source passages. The same bounded source index supports very short messages and
long documents. This is a read-only evidence review, not a general family agent,
universal parser, semantic answer engine, or permission to execute actions.

## What is available

Cue labels cover school, lessons, nursery/kindergarten, health, travel, homework,
library, police/emergency/safety, household/eldercare/pets and an explicit other
fallback. Topics cover schedules, deadlines, requirements, submissions,
reservations, contacts, costs and other. These are keyword hints; every original
passage remains reachable even when no keyword is recognized. No label means
only that a known cue did not match. Japanese and common English expressions are
covered, not every language, spelling, inflection, situation or document type.

Each returned item includes the original citation, adjacent source context,
domain/topic hints and conditional, negation, revision or relative-date cues.
Domains and topics are based only on that item's quote; headings and neighbors
are not silently assigned to the item. Caution flags include one neighbor on
each side in the same source container. Further-away conditions, document-wide
revisions, mixed-person tables and multi-document changes can still be missed.
No obligation, latest version, absolute date or person's applicability is inferred.

The SDK `memberLabel` is an explicit local user annotation, not a source/person
filter. Its `sourceIdentityVerified` is always false. `annotateFamilyCitation`
checks exact source/snapshot citation identity before returning a separate
`user_annotation` with an optional corrected domain/topic/member/note. It does
not mutate original text or extracted labels and does not persist anything.
Rebuild after any source change; old annotations must then be reviewed again.
Hosts must bind annotations to current account/store/member scope too.

## Paging and reading coverage

`limit` is 1–50 (default 20); `offset` is 0–20,000 (default 0), an ordinal into
matching passages, **not** a character/source offset. `nextOffset` continues a
review. Optional `domain`/`topic` filters apply only to cue labels. Clear filters
to inspect other/unclassified passages. Coverage distinguishes indexed UTF-16
units, total source passages, cue-recognized/unmatched passages, matching passages
after filters, returned passages and remaining results. Reaching the last page
is not a completeness or understanding guarantee (`completeUnderstanding=false`).
The canonical contract rejects an empty document. Unsupported/over-limit input
fails visibly rather than silently truncating; unknown missing pages cannot be
counted by this SDK without upstream metadata. Matoe separately surfaces known
unavailable pages from its existing saved OCR/page store.

The existing v7 immutable representation hash, exact original UTF-16 locators,
NFKC matching, input preflight, cancellation and hard budgets are unchanged.
A first family review computes bounded cue hints once and publishes the cache
only when complete; subsequent pages/filters reuse it within that source index.
Returned arrays and citations are copies. No global cache or persistence exists.
`AbortSignal` is checked per passage; the synchronous API does not yield the JS
event loop. Hosts should run indexing/review off their UI thread.

## Privacy and input boundary

Everything here uses explicitly supplied local canonical text/pages/chunks.
CLI accepts UTF-8 text/Markdown/CSV or `--canonical-json`, with explicit
`--include-evidence` for source quotations in local stdout. Protect stdout/logs
when using real family/health/child data. No remote provider, credentials, new
dependency, network request, diagnosis, legal conclusion, emergency dispatch,
booking, contact, payment or action write was added. Existing approval/execution
boundaries and schema are unchanged.

Binary PDF, images, Office, email containers and unreadable scans still require
an appropriate upstream parser/OCR. This feature cannot repair missing pages,
OCR errors, source revisions or unsupported formats. For medical, legal, police
or urgent safety content, verify the original and use appropriate human help;
these local excerpts are not professional or emergency advice.

## Matoe contract and verification

Matoe mirrors these cue strings and fixtures in a native, session-only family
review within its existing original-document question route. Native/member scope
hashes differ intentionally from TS hashes. The current source is not a remote
bridge or a claim of Xcode/runtime parity. Shared fixture tests execute TS; native
XCTest source is separately authored and must run on Xcode before acceptance.

Run `node --import tsx scripts/check-family-review-fixtures.ts` and normal project
checks. `scripts/family-review-benchmark.ts` reports synthetic index/initial/reused
paging/filter timings, not iPhone latency, semantic accuracy or peak memory.
