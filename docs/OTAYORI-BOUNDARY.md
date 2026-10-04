# Otayori boundary

Action Manifest OSS is a **shared library and CLI**. Otayori is a **product**. They share a Manifest contract. They do not share UX, identity, or billing.

## OSS owns

- Action Manifest schema and versioning
- Canonical Document interface
- Document adapters (plain text, future Docling/etc.)
- Extractor + provider interface
- Deterministic verifier and Evidence rules
- Temporal / modality parsing (JP first-class)
- Benchmark fixtures and metrics
- CLI / library API
- File exporters (JSON, ICS, future CalDAV payload files)

## Otayori owns

- Child / family profiles
- Family inbox and school-notice classification
- Family sharing and permissions
- Notifications and parent UX
- Original document storage and retention
- Submission UI (“mark as submitted”)
- Subscriptions and commercial packaging
- Any Google / school-system OAuth

## Integration rule

Otayori SHOULD import `@actionmanifest/*`, run extract+verify locally or in its backend, then store Manifests next to documents Otayori already keeps. Otayori MUST NOT require this OSS to know what a “child” is.

Phase 1 did **not** integrate Otayori (ENG-20260909-001 gate ④). The explicit
[Matoe compatibility profile](MATOE-COMPATIBILITY.md) now provides a wire-only
projection in the consumer package and CLI, with the complete original manifest
retained for audit. It does not integrate HTTP, product storage, child/family
models, UX, identity, billing, or action execution. Those remain product-owned.

## Matoe-first integration, reusable OSS contract

Matoe is a primary integration target; its current Swift display limits are
**not** the limits of ActionManifest. Other applications use the same public
schema, document adapters, extractor, verifier and reference consumer without
opting into the Matoe projection. No app identity, family account or backend
configuration is required by the shared pipeline.

| Boundary | Public API / owner | Responsibility |
| --- | --- | --- |
| Input documents | `@actionmanifest/adapters`: `DocumentAdapter`, `PlainTextAdapter`; other parsers implement the canonical boundary | Produce validated canonical text and locators, independent of product UI |
| Extraction and verification | `ActionExtractor`, `verifyManifest`, `validateActionManifest` | Default frozen 0.2 contract; preserve role, conditions, notes, timezone, temporal uncertainty/alternatives and every Evidence; verify support against the source |
| Generic consumption | `classifyManifest`, `readyActions` in `@actionmanifest/consumer` | Shared per-Action trust policy, surface reasons; no Matoe display restrictions |
| Optional Matoe wire | `prepareMatoeManifest(input, canonicalSourceText)` in the same consumer package; CLI `prepare-matoe` | Explicit current Swift 0.1 profile, representability/refusal and full-original audit bundle |
| Product decisions | The consuming application | Render all relevant information, user review/approval, storage, source authenticity, HTTP and execution |

The shared modules do not import the Matoe projection. Importing the consumer
package does not apply it: callers explicitly invoke `prepareMatoeManifest`.
`classifyManifest` classifies an already obtained manifest/receipt; it does not
validate untrusted JSON or authenticate receipt issuers. Validate external input,
verify against the canonical source where appropriate, and apply your own
display/review policy. `ready` is not user approval or proof that a UI displays
every field. File exporters also have their own representation constraints;
generic JSON is the lossless representation of these Action fields.

For example, a source-supported guardian role or rain alternative may be verified
and retained in 0.2 for another consumer while the current Matoe projection
refuses it. Do not delete those fields to pass the Matoe gate. A failed projection
does not mutate the original manifest or its generic classification. The
built-public-API regression in
`integration/reference-consumer/test/consumer-boundary.test.ts` checks this for
role, timezone, conditions, notes, distinct Evidence, approximate dates, rain
alternatives and warnings.

Use the [generic library example](examples/library-quick-start.ts) for a new
consumer. Use the [Matoe guide](MATOE-COMPATIBILITY.md) only for its Swift wire
boundary, and [design handoff](MATOE-DESIGN-HANDOFF.md) for the remaining product
changes. No generic plugin/profile framework is needed for these two existing
APIs. License, package versions and publishing policy are unchanged.
