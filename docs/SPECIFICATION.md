# Action Manifest Specification v0.1

Schema version: `0.1.0`  
JSON Schema: `packages/schema/src/action-manifest.schema.json`

## Compatibility policy

- **Patch** (`0.1.x`): documentation, extra optional fields that old readers ignore (`additionalProperties: false` on v0.1 means patch MUST NOT add fields without a minor bump).
- **Minor** (`0.x`): additive optional fields, new `x-*` enum values, new action kinds via `x-*`. Old manifests remain valid.
- **Major** (`1.0.0+`): breaking field renames or required-field changes. A migrator MUST be documented.

Readers SHOULD ignore unknown `x-*` kinds/modalities. Writers SHOULD NOT emit unknown kinds except `x-*` extensions.

Enums are forward-compatible: known values plus `^x-[a-z0-9-]+$`.

## Action

Required: `id`, `kind`, `title`, `modality`, `actor`, `evidence` (≥1), `inference`, `status`.

### kind

`event | deadline | submit | prepare | pay | review | reply | sign | attend | contact | read | complete | other | x-*`

### modality

`required | recommended | optional | prohibited | unknown | x-*`

Eligibility (希望者のみ, 参加者のみ) is **not** a sixth modality. Encode it in `conditions[]` and actor. A required submit that applies only to applicants is `modality=required` + conditions, never a blanket “everyone must submit”.

### actor.certainty

`explicit | implicit | unknown`

### temporal

| type | When to use | `date` allowed? |
| --- | --- | --- |
| exact | Calendar day stated, or month+day + year inherited from same doc | yes |
| approximate | 頃, 上旬/中旬/下旬, around October | **no** |
| range | start/end stated | start/end |
| relative | 当日, 後日, tomorrow | no (unless resolved later by an app, not Core) |
| recurring | weekly, 毎週 | optional rule string |
| conditional | 雨天順延, 予備日 | yes if a backup calendar day is stated |
| unknown | cannot classify | no |

Also: `raw_text` (verbatim), `precision`, `timezone`, `deadline_qualifier` (`until | must_arrive | postmark_valid | on_day | later | unknown`), `alternatives[]`.

Japanese era: 令和1=2019, 令和8=2026 (`year = 2018 + n`).

### evidence

`source_id`, `text` (short quote, max 2000 chars), optional `page`, `bbox`, `section`, `source_reference`. Do not copy the full document into evidence.

### confidence (optional, light)

`action`, `temporal`, `actor`, `evidence` in `[0,1]`.

### inference

`explicit` if the document states the action; `inferred` if year or actor was filled from context.

### status (review lifecycle)

`proposed → verified → accepted | rejected → exported`

Core sets `proposed` or `verified`. Apps set `accepted` / `rejected` / `exported`. Exporting does not mean the action was executed.

## Receipt

See Architecture. Verification flags are **deterministic** in Phase 1.

## Errors (no silent fallback)

| code | Meaning |
| --- | --- |
| SCHEMA_VALIDATION | JSON/type violation |
| MALFORMED_LLM_OUTPUT | Non-JSON or missing `actions` |
| PROVIDER_TIMEOUT | Deadline exceeded |
| PROVIDER_ERROR | HTTP/provider failure |
| DOCUMENT_ADAPTER | Adapter cannot handle input |
| NOT_IMPLEMENTED | e.g. live Docling |
| MISSING_API_KEY | openai selected without key |

Retries: `ACTIONMAN_MAX_RETRIES` default **0**. No provider downgrade.

## Security / privacy

- Fixtures are synthetic. No real PII, no copyrighted notices.
- Never commit API keys. `.env.example` only.
- Default extractor is local. OpenAI-compatible: source leaves the machine.
- No telemetry.
- Logs MUST NOT print full documents (CLI prints evidence quotes only).
- Evidence quotes should be the supporting span, not the whole page.

## Benchmark metrics

Action Recall / Precision, Deadline / Actor / Modality accuracy, Evidence Match, **Hallucination Rate** (lower better), **Ambiguity Preservation** (higher better). Golden fixture MUST pass.

Fixture layout (50+ ready): `benchmark/fixtures/{ja,en}/<id>/{input.txt,expected.json,meta.json}`.
