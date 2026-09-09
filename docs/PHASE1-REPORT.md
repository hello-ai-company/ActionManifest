# Action Manifest OSS — Phase 1 Report

Case: PA-20260909-001 / Personal AI社  
Date: 2026-09-09

## Verdict PASS

Phase 1 Definition of Done is met. Live Docling conversion and live LLM extraction are **intentionally** out of CI (mock/deterministic providers). Product name is not frozen (`actionman` is provisional).

## Architecture

Language-neutral **JSON Schema v0.1** + one TypeScript implementation (pnpm workspaces). Constitution is encoded in schema + verifier:

1. Source before inference (Evidence required; quotes must appear in source)
2. Unknown stays unknown (「10月頃」「10月上旬」 never become `2026-10-01`)
3. Extraction is not execution (JSON/ICS files only)
4. Models replaceable (`deterministic` default, `openai-compatible` opt-in)
5. Documents replaceable (Canonical Document; Plain Text working; Docling fixture-only)

See `docs/adr/0001-phase0-language-and-architecture.md` and `docs/ARCHITECTURE.md`.

## Implemented

- JSON Schema v0.1 (`packages/schema`)
- Canonical Document + SHA-256 source hash
- Plain Text adapter (working)
- Docling adapter: interface + synthetic JSON fixtures (`NOT_IMPLEMENTED` for live PDF/OCR)
- ActionExtractor + OpenAI-compatible provider + mock + deterministic notice extractor
- Deterministic verifier (evidence, temporal, actor, modality, hash, pages, negation)
- JP-first temporal/modality (令和, まで, 上旬/頃, 雨天順延, 予備日, 必着, 消印有効, 希望者のみ, 参加者のみ, 各自持参, 当日徴収, 後日提出, 提出不要, 前回提出した方は不要)
- CLI `actionman extract|validate|benchmark` (`--json`, ICS export)
- JSON + ICS (VEVENT / VTODO) exporters
- 29 synthetic fixtures (JP 20 / EN 9), layout ready for 50+
- Golden Fixture PASS
- Lint, typecheck, unit/integration tests, schema validation, benchmark smoke
- OSS files: LICENSE Apache-2.0, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, GitHub Actions

## Explicitly Not Implemented

- Live Docling / Marker / PaddleOCR / PDF bytes
- LLM-as-judge verifier
- Google Calendar / Gmail / Todoist / CalDAV **writes**
- Chat UI, RAG, accounts, Supabase/Firebase/Stripe
- iOS/Android, family sharing, notifications
- Otayori product features (see `docs/OTAYORI-BOUNDARY.md`)
- Dual Python implementation
- Frozen product name

## Action Manifest v0.1

`schema_version: 0.1.0`. Kinds, modality, actor certainty, temporal types, evidence locators, light confidence, inference, review lifecycle `proposed → verified → accepted | rejected → exported`. Forward-compatible `x-*` enums. Receipt: extraction provenance + verification flags (mappable to PROV-O later, not PROV-O).

## Verification Model

Deterministic only. Flags: `evidence_supported`, `temporal_supported`, `actor_supported`, `modality_supported`, `source_hash_matched`, `negation_conflict`, `page_refs_valid`. Fail closed on malformed LLM JSON (`MALFORMED_LLM_OUTPUT`). Default retries = 0. No silent provider fallback.

## Benchmark

| | |
| --- | --- |
| Fixtures | 29 (JP 20 / EN 9) |
| Golden | **PASS** (`school-golden-excursion`) |
| Action Recall | 96.6% |
| Action Precision | 77.0% |
| Deadline Accuracy | 89.7% |
| Actor Accuracy | 92.0% |
| Modality Accuracy | 60.3% |
| Evidence Match | 100.0% |
| Hallucination Rate | **1.7%** (lower is better) |
| Ambiguity Preservation | **100.0%** |
| Verifier pass rate | 100.0% |

Hallucination failures: none on Golden. Remaining 1.7% is a single fixture (`school-already-submitted`) where an exemption sentence appears *before* the positive submit and is emitted as a separate prohibited action. Precision is pulled down by extra dated sentences (e.g. 予備日 as its own action). Categories covered: school, government, workplace, event, contract, invoice, university, housing, insurance.

## Quality Gate

| Gate | Result |
| --- | --- |
| lint | PASS |
| typecheck | PASS |
| unit + integration tests | PASS (37) |
| schema validation | PASS |
| benchmark / golden | PASS |
| CLI extract + validate + ICS | PASS |

Live OpenAI-compatible calls are not run in CI (no API key; fail closed if selected without a key).

## Security / Privacy

- Synthetic fixtures only; no real PII
- `.env.example` only; keys never committed
- Default provider is local; `--provider openai` sends source to `OPENAI_BASE_URL` (documented)
- No telemetry
- Evidence quotes capped; CLI does not dump full documents to logs
- LICENSE Apache-2.0 (patent grant for embedders) — see NOTICE

## Files Added / Changed

New TypeScript monorepo: `packages/{schema,core,adapters,temporal,extractor,verifier,exporters}`, `apps/cli`, `benchmark/fixtures`, `docs/*`, OSS governance, `.github/workflows/ci.yml`. Original `README.md` stub replaced.

## Known Risks

- Deterministic extractor is notice-oriented; general English/JP prose still needs an LLM for recall/precision beyond fixtures
- Year inheritance from 令和N年 in the same document is inferred — correct for Golden, must stay scoped to that document
- Recursive `temporal.alternatives` in JSON Schema is accepted by Ajv 2020
- CLI name `actionman` / internal name `action-manifest` are provisional
- pnpm 10 may skip the esbuild install script; CI runs `node node_modules/esbuild/install.js`

## Recommended Phase 2

1. Live Docling adapter (optional Python sidecar or HTTP) without putting PDF code in Core
2. Record/replay LLM fixtures; optional LLM verifier as a clearly marked extension
3. CalDAV file export and n8n node that **consumes** manifests (still no Core execution)
4. Grow benchmark to 50+; raise modality accuracy (hopeful vs required)
5. Merge exemption sentences that precede the positive submit
6. WASM/browser extract for Otayori without Node fs

## Git Status (branch, commit, working tree)

- Branch: `cursor/phase1-action-manifest-edf9` (from `main`)
- HEAD: `c53008b`
- Working tree: clean
- Commits: schema → core → verifier/extractor/CLI → golden fixtures → docs
