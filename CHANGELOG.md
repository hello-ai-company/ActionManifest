# Changelog

All notable changes to this project are documented here. Schema version is independent of package versions; see `docs/SPECIFICATION.md`.

## 0.1.1 — 2026-09-09

### Added

- ENG-20260909-001 completion gates (synthetic Golden, public boundary, Core no external writes, no Otayori logic, evidence pack)
- `docs/PUBLIC-BOUNDARY.md` (public repo: OSS + synthetic fixtures + spec only)
- Placeholder `evidence/ENG-20260909-001/` for Eng ops after PA-03E review
- Guard tests for synthetic fixtures and Core I/O


## 0.1.0 — 2026-09-09

### Added

- Action Manifest JSON Schema v0.1.0
- Canonical Document model and Plain Text adapter
- Docling adapter interface + fixture mapping (no live OCR)
- Deterministic verifier (evidence, temporal, actor, modality, hash, pages, negation)
- Japanese-first temporal/modality parser
- Extractor with deterministic provider + OpenAI-compatible provider
- JSON and ICS (VEVENT/VTODO) exporters
- `actionman` CLI: extract, validate, benchmark
- 28 synthetic JP/EN benchmark fixtures including Golden Fixture
- GitHub Actions: lint, typecheck, test, schema validation, benchmark smoke
