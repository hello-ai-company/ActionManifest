# Public boundary

This repository is **public**. Everything committed here is treated as publishable OSS. Ticket **ENG-20260909-001**.

## Publishable (OK in this repo)

- Action Manifest JSON Schema and TypeScript types
- Canonical Document interface and adapters (plain text; Docling fixture mapping)
- Deterministic verifier, temporal/modality parsers, extractor interfaces
- OpenAI-**compatible** client shape (no keys, no tenant URLs)
- Synthetic Golden and benchmark fixtures (hand-written, not from production)
- CLI, JSON/ICS exporters (file output only)
- Architecture, specification, Otayori **boundary** docs (product names as future consumers)
- CI workflows, Apache-2.0 license, Contributor Covenant
- Completion evidence under `evidence/ENG-20260909-001/` (test/CI logs, diff summaries — no secrets)

## Secret / internal-only (MUST NOT be committed)

- API keys, tokens, `.env` values (`OPENAI_API_KEY`, customer keys)
- Real user documents, school notices, invoices, emails, OCR of production mail
- Personal names, child/family profiles, school IDs, addresses, phone numbers
- Otayori production configs, tenant IDs, billing, subscription state
- Internal runbooks, customer lists, Personal AI 社 confidential strategy beyond the public OSS charter
- Gmail / Google Calendar OAuth client secrets

## Product names vs product code

Naming **Otayori**, Personal AI, or future apps as *consumers* in docs is public and allowed. Importing Otayori packages, encoding child/family/inbox logic, or shipping Otayori UX in this repo is **not** allowed (ENG-20260909-001 gate ④).

## Stop-the-line

If real Evidence (production or end-user documents) is found in fixtures or examples, **do not merge**. Remove it first. President / CTO confirmation is required before merging ENG-20260909-001 work. This agent does not merge.

See [ENG-20260909-001 completion gates](ENG-20260909-001.md).
