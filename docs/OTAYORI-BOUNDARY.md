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

Phase 1 of this repository does **not** integrate Otayori. There are no Otayori packages, types, child/family models, or product rules in `packages/` or `apps/cli`. Naming Otayori in this document is a consumer-boundary note only (ENG-20260909-001 gate ④).
