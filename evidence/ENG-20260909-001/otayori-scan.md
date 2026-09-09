# Otayori references in code (gate ④)

packages/ and apps/ must have zero Otayori imports.

none in packages/ or apps/

Docs-only references (allowed as consumer boundary):
README.md:50:This repo is **public**. See [docs/PUBLIC-BOUNDARY.md](docs/PUBLIC-BOUNDARY.md) for what may be committed vs keys, real documents, and Otayori internals.
README.md:52:ENG-20260909-001 gates: synthetic Golden only · documented public boundary · Core does not write to external systems · no Otayori product logic · evidence under `evidence/ENG-20260909-001/`. **Do not merge without President / CTO confirmation.**
README.md:68:## Otayori vs this OSS
README.md:70:This repository owns Manifest, Extractor, Verifier, Evidence, Temporal, Benchmark, CLI, Exporter, Document adapters. Product UX, family inbox, child profiles, notifications, and billing belong in Otayori — see [docs/OTAYORI-BOUNDARY.md](docs/OTAYORI-BOUNDARY.md).
docs/ARCHITECTURE.md:3:Action Manifest is a **common extraction-and-verification layer**. Downstream apps (Otayori, n8n, Todoist importers, CalDAV, agents, MCP, Home Assistant, business systems) may consume manifests. They are not implemented here.
docs/ARCHITECTURE.md:64:See [adr/0001-phase0-language-and-architecture.md](adr/0001-phase0-language-and-architecture.md). JSON Schema is language-neutral; one TypeScript implementation in Phase 1 (npm CLI). No dual Python port yet. Docling remains an adapter target. Otayori is a future consumer only — not an in-repo dependency.
docs/OTAYORI-BOUNDARY.md:1:# Otayori boundary
docs/OTAYORI-BOUNDARY.md:3:Action Manifest OSS is a **shared library and CLI**. Otayori is a **product**. They share a Manifest contract. They do not share UX, identity, or billing.
docs/OTAYORI-BOUNDARY.md:17:## Otayori owns
docs/OTAYORI-BOUNDARY.md:30:Otayori SHOULD import `@actionmanifest/*`, run extract+verify locally or in its backend, then store Manifests next to documents Otayori already keeps. Otayori MUST NOT require this OSS to know what a “child” is.
docs/OTAYORI-BOUNDARY.md:32:Phase 1 of this repository does **not** integrate Otayori. There are no Otayori packages, types, child/family models, or product rules in `packages/` or `apps/cli`. Naming Otayori in this document is a consumer-boundary note only (ENG-20260909-001 gate ④).
docs/PHASE1-REPORT.md:45:- Otayori product features (see `docs/OTAYORI-BOUNDARY.md`)
docs/PHASE1-REPORT.md:95:| ④ No Otayori-specific logic | PASS — Otayori named in docs as consumer only |
docs/PHASE1-REPORT.md:130:6. WASM/browser extract for Otayori without Node fs
docs/adr/0001-phase0-language-and-architecture.md:23:| TS + JSON Schema | Otayori (likely TS), npm CLI, Ajv validation, ICS as text, GitHub Actions | One toolchain |
docs/adr/0001-phase0-language-and-architecture.md:24:| Python + JSON Schema | Docling/PaddleOCR ecosystem, scientific NLP | Weaker npm CLI / Otayori path; still need a JS CLI later |
docs/adr/0001-phase0-language-and-architecture.md:68:Custom OCR/PDF renderer, RAG, chat UI, accounts, Supabase/Firebase/Stripe, Gmail/Calendar OAuth, mobile, family sharing, notifications, full task/document managers, workflow builders, live Docling/Marker/PaddleOCR engines, Otayori product features.
