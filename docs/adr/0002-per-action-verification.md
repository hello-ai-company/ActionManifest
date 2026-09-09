# ADR 0002 — Phase 1.1: Per-Action verification semantics

Status: Accepted
Date: 2026-09-09
Supersedes part of: ADR 0001 (verifier semantics only)

## Context

Phase 1 aggregated verification at the **manifest** level. A single boolean set
(`evidence_supported`, `temporal_supported`, …) described the whole manifest, and
status promotion used that aggregate: if everything passed, **every** Action was
promoted `proposed → verified`; otherwise **none** were.

That is wrong for the product. A notice routinely yields several independent
Actions:

```
Document
├─ Action A (valid event)      → should be VERIFIED
├─ Action B (hallucinated date) → should stay PROPOSED
└─ Action C (valid prepare)     → should be VERIFIED
```

With manifest-level aggregation, B alone blocked A and C. Downstream apps could
not tell which Actions are individually trustworthy — defeating the purpose of
Action Manifest, whose value is *per-Action machine-checkable trust*, not merely
"the model extracted something".

## Decision

### 1. Verification is per Action (new constitutional principle)

Each Action is verified **independently** from its own Evidence, Temporal, Actor,
Modality and Negation. One Action's failure never changes another Action's
verdict. `verifyAction()` returns an `ActionVerificationResult`:

```ts
interface ActionVerificationResult {
  action_id: string;
  passed: boolean;            // intrinsic per-action verdict
  evidence_supported: boolean;
  temporal_supported: boolean;
  actor_supported: boolean;
  modality_supported: boolean;
  negation_conflict: boolean;
  page_refs_valid: boolean;
  issues: VerificationIssue[];
}
```

### 2. Per-Action status promotion

```
for each action:
  verify independently
  if action.passed AND no manifest-level fatal:  proposed → verified
  else:                                          keep existing status
```

The global "promote all if everything passed" logic is removed. Promotion only
ever lifts `proposed`; it never rewrites `accepted` / `rejected` / `exported`.

### 3. Fatal (manifest-level) vs per-Action failures

| Class | Examples | Effect |
| --- | --- | --- |
| **Manifest-level fatal** | source hash mismatch, empty canonical document, schema-invalid/corrupted manifest | The document itself is untrustworthy → **no** Action may be promoted, even ones that pass intrinsically. `passed=false`. |
| **Per-Action failure** | evidence not in source, temporal hallucination, actor unsupported, modality unsupported, negation conflict, invalid page ref for one Action | Only the offending Action fails; others are unaffected. |

`source_hash_matched` lives on the summary because it is cross-cutting. A per-
Action result never folds it in, so `action_results[].passed` always reports the
Action's intrinsic truth even when a fatal condition blocks promotion.

### 4. Manifest summary (aggregate) is retained

`receipt.verification` keeps the seven v0.1 booleans plus `issues[]` as a
backward-compatible summary (AND-aggregate across Actions; `negation_conflict` is
the OR-aggregate). Their meaning is **unchanged** (`evidence_supported === true`
still means "every Action's evidence is supported"). Phase 1.1 **adds** optional
fields: `passed`, `total_actions`, `verified_actions`, `failed_actions`,
`warning_actions`, and `actions[]`.

- `verified_actions` = Actions promoted (`passed && !fatal`).
- `failed_actions` = `total_actions - verified_actions` (includes Actions blocked
  by a fatal condition; their intrinsic verdict is still in `actions[]`).
- `passed` = `!fatal && every action passed`.

### 5. Actor semantics (hardening)

| `actor.certainty` | `actor.text` | Rule |
| --- | --- | --- |
| `explicit` | **required** | Must be present **and** appear in the Action's evidence, else `actor_supported=false` (`ACTOR_TEXT_MISSING` / `ACTOR_UNSUPPORTED`). |
| `implicit` | optional | Not forced to appear verbatim in evidence. |
| `unknown` | forbidden-ish | Never invent an actor; always `actor_supported=true`. |

This fixes the Phase 1 bug where `explicit` with no `actor.text` (or text absent
from evidence) could still pass.

### 6. API

- `verificationPassed(flags)` = manifest-level full pass (uses `flags.passed`
  when present; otherwise the legacy aggregate). Unchanged meaning for callers.
- `actionVerificationPassed(result)` (new) = a single Action's intrinsic pass.

## Schema versioning decision

The change adds **only optional** fields to `receipt.verification` and a new
`ActionVerificationResult` def. Under the SPECIFICATION compatibility policy,
adding fields while `additionalProperties: false` is a **minor** bump, so the
schema moves to **`0.2.0`**.

**Versioned schemas are immutable.** Each `schema_version` maps to its own frozen
JSON Schema under `packages/schema/schemas/<version>/`:

- `schemas/v0.1/action-manifest.schema.json` — `$id …/v0.1/…`, `const 0.1.0`,
  the Phase 1 contract with **no** per-action fields.
- `schemas/v0.2/action-manifest.schema.json` — `$id …/v0.2/…`, `const 0.2.0`,
  with the per-action verification fields.

**`schema_version` selects its exact schema.** `validateActionManifest()`
identifies the version first and dispatches to that schema
(`0.1.0` → v0.1, `0.2.0` → v0.2, else Unsupported), failing closed on a
non-object payload or a missing/non-string version and never casting before
dispatch. There is **no** single schema that accepts multiple versions (the
earlier `enum: ["0.1.0","0.2.0"]` approach is rejected because it let a
`0.1.0`-declared manifest carry v0.2-only fields — a contract violation).

**A 0.1 manifest cannot contain 0.2-only fields.** A legacy 0.1.0 manifest still
validates (against the frozen v0.1 schema); new manifests are emitted as 0.2.0.

Backward compatibility contract: old and new booleans never contradict — the new
per-Action `actions[]` is strictly more information, and the old aggregate
booleans retain their v0.1 meaning as an AND/OR summary of the per-Action set.

## Evidence source identity (pre-merge hardening)

`EVIDENCE_SOURCE_ID` is a **per-Action verification failure** (severity `error`),
not a warning. Evidence supports its Action only when the quote appears in the
canonical text **and** the `source_id` belongs to the current canonical source
(manifest `source.id` or document id). A mismatch sets `evidence_supported=false`
and keeps that Action `proposed`, even if the quote happens to appear in the
text. It stays per-Action (never manifest-level fatal) and does not affect other
Actions — enforcing *source before inference*.

## Consequences

- Downstream consumers can trust valid Actions from a partially-invalid manifest.
- CLI `actionman validate` reports `PARTIAL` with per-Action `[VERIFIED]/[FAILED]`
  and reasons; `--json` exposes `flags.actions[]`.
- Benchmark gains an action-level `actionVerificationRate` alongside the manifest
  pass rate, leaving room for future action-level accuracy metrics.
- The Golden Fixture and all Phase 1 behavior are preserved.
