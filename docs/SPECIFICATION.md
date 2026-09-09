# Action Manifest Specification v0.2

Schema version: `0.2.0` (readers also accept `0.1.0`)
JSON Schemas (immutable, versioned): `packages/schema/schemas/v0.1/action-manifest.schema.json`, `packages/schema/schemas/v0.2/action-manifest.schema.json`

## Compatibility policy

- **Patch** (`0.x.y`): documentation, extra optional fields that old readers ignore (`additionalProperties: false` means patch MUST NOT add fields without a minor bump).
- **Minor** (`0.x`): additive optional fields, new `x-*` enum values, new action kinds via `x-*`. Old manifests remain valid.
- **Major** (`1.0.0+`): breaking field renames or required-field changes. A migrator MUST be documented.

### Versioned schemas are immutable

**Each `schema_version` maps to its own frozen JSON Schema.** `schema_version`
selects its exact schema; a reader identifies the version first and dispatches to
that schema. There is **no** single schema that accepts multiple versions.

- `0.1.0` → `schemas/v0.1/action-manifest.schema.json` (`$id …/v0.1/…`, `const 0.1.0`). Frozen Phase 1 contract; it does **not** contain the per-action verification fields.
- `0.2.0` → `schemas/v0.2/action-manifest.schema.json` (`$id …/v0.2/…`, `const 0.2.0`). Adds the optional per-action fields.

Consequences:

- **A 0.1.0 manifest cannot contain 0.2-only fields.** `{ "schema_version": "0.1.0", … "verification": { "actions": [...] } }` is **invalid** — it is validated against the frozen v0.1 schema.
- Missing / non-string `schema_version`, a non-object payload, or an unknown version (e.g. `0.3.0`) **fails closed**; the reader never casts on `schema_version` before dispatching.
- Existing 0.1.0 manifests still validate (against v0.1); writers emit `0.2.0`.

### 0.1.0 → 0.2.0 (Phase 1.1, additive minor)

`0.2.0` adds only **optional** fields to `receipt.verification` (`passed`,
`total_actions`, `verified_actions`, `failed_actions`, `warning_actions`,
`actions[]`) plus the `ActionVerificationResult` def. Because these are optional
under `additionalProperties: false`, adding them is a **minor** bump (not patch),
shipped as a **new immutable schema** (v0.2) rather than mutating v0.1. Rationale
in [adr/0002-per-action-verification.md](adr/0002-per-action-verification.md).

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

- **explicit** — the document names the actor. `actor.text` is **required** and MUST appear in that Action's evidence; otherwise `actor_supported=false` (`ACTOR_TEXT_MISSING` / `ACTOR_UNSUPPORTED`). Use for e.g. 「保護者」, 「参加を希望する方」, "applicants".
- **implicit** — the actor is implied by context (e.g. 各自 / "each participant"). `actor.text` is optional and is NOT forced to match evidence verbatim.
- **unknown** — the actor is not determinable. Never invent one; `actor_supported` is always true.

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

**Evidence source identity is a per-Action trust condition.** An Evidence object supports its Action only when the quote appears in the canonical text **and** its `source_id` belongs to the current canonical source (equals the manifest `source.id` or the document id). A mismatched `source_id` is a **per-Action verification failure** (`EVIDENCE_SOURCE_ID`, severity `error`) that sets `evidence_supported=false` and keeps the Action `proposed` — even if the quote happens to appear in the text. It is per-Action (not manifest-level fatal) and does not affect other Actions. This enforces *source before inference*.

### confidence (optional, light)

`action`, `temporal`, `actor`, `evidence` in `[0,1]`.

### inference

`explicit` if the document states the action; `inferred` if year or actor was filled from context.

### status (review lifecycle)

`proposed → verified → accepted | rejected → exported`

Core sets `proposed` or `verified`. Apps set `accepted` / `rejected` / `exported`. Exporting does not mean the action was executed.

### status (review lifecycle) — promotion is per Action

`proposed → verified → accepted | rejected → exported`. The verifier promotes
each Action **independently**: `proposed → verified` only when that Action's own
checks pass AND there is no manifest-level fatal failure (source hash mismatch,
empty document). A failing Action stays `proposed`; its `verification.passed`
is `false`. No new failure status is introduced — `status=proposed` +
`actions[].passed=false` expresses an unverified Action.

## Receipt

See Architecture. Verification flags are **deterministic** in Phase 1/1.1.

`receipt.verification` carries both the v0.1 aggregate booleans (summary) and,
from 0.2.0, per-Action results:

```jsonc
"verification": {
  "passed": false,
  "source_hash_matched": true,
  "total_actions": 3, "verified_actions": 2, "failed_actions": 1, "warning_actions": 0,
  "evidence_supported": false, "temporal_supported": false, "actor_supported": true,
  "modality_supported": true, "negation_conflict": false, "page_refs_valid": true,
  "actions": [
    { "action_id": "act_001", "passed": true,  "evidence_supported": true,  "temporal_supported": true,  "actor_supported": true, "modality_supported": true, "negation_conflict": false, "page_refs_valid": true, "issues": [] },
    { "action_id": "act_002", "passed": false, "evidence_supported": true,  "temporal_supported": false, "actor_supported": true, "modality_supported": true, "negation_conflict": false, "page_refs_valid": true, "issues": [ { "code": "TEMPORAL_UNSUPPORTED", "message": "…", "action_id": "act_002", "severity": "error" } ] }
  ]
}
```

APIs: `verificationPassed(flags)` → manifest-level full pass;
`actionVerificationPassed(result)` → one Action's intrinsic pass.

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

Action Recall / Precision, Deadline / Actor / Modality accuracy, Evidence Match, **Hallucination Rate** (lower better), **Ambiguity Preservation** (higher better), **Verifier pass rate** (manifest-level) and **Action verify rate** (verified Actions / total Actions, action-level). Golden fixture MUST pass.

Fixture layout (50+ ready): `benchmark/fixtures/{ja,en}/<id>/{input.txt,expected.json,meta.json}`.
