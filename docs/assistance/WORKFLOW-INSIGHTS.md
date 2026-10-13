# Offline workflow impact and recovery insights

These optional consumer SDK reports make local plans easier to review. They do not
execute a step, invoke a host, reconcile a journal, retry a commit, create a challenge,
consume approval or change a stored record. Existing coordinator and host checks
remain the only local execution path. Frozen manifest schemas and workflow storage
versions are unchanged.

## Preview before exact approval

```ts
import { previewLocalWorkflowImpact, formatLocalWorkflowImpact } from "@actionmanifest/consumer";

const options = { now: "2026-10-12T08:00:00.000Z", context: currentContext };
const impact = previewLocalWorkflowImpact(plan, options);
console.log(formatLocalWorkflowImpact(plan, options));
```

Supply a valid plan from `planLocalWorkflow` or `planLocalPreparation`. The preview
shows exact local task/schedule arguments grouped by destination, separate blocked
selections and held review items, plan freshness and optional context comparison.
`matches_snapshot` means comparison with the supplied context only, not a live
permission check or an approval. Missing context is `not_checked`; expired/future
plans and changed permissions, ledger or destinations cannot be presented as current.

Optionally supply `prior_workflows: string[]` of private host workflow JSON snapshots.
Semantically matching verified records become `prior_snapshot` duplicate hints; repeated
semantic steps in the plan become `same_plan`. There are no automatic removals, merges
or skipped operations. A prior record may have changed or been removed since its snapshot.
`none_observed` never proves absence of a local record. The host must read actual records
and enforce the existing semantic idempotency rules when execution is authorized.

## Diagnose interruption without blind retries

```ts
import { adviseLocalWorkflowRecovery, formatLocalWorkflowRecovery } from "@actionmanifest/consumer";

const options = { now: "2026-10-12T08:00:00.000Z", context: currentContext };
const advice = adviseLocalWorkflowRecovery(privateWorkflowJson, options);
console.log(formatLocalWorkflowRecovery(privateWorkflowJson, options));
```

- Running/uncertain/recorded-verified steps call for actual local record inspection.
  Unknown outcomes are neither confirmed failure nor success. Do not blindly retry.
- Partial workflows keep held review/blocked items visible. Some saved records do not
  mean the user's entire intent is finished.
- Expired/future plans or changed context call for review and replanning, preserving
  idempotency and checking existing records first.
- Missing, unconsumed or expired confirmation may call for renewed exact review through
  the trusted host. The report itself cannot approve it.
- Cancelled workflows remain cancelled. Records created earlier may remain; cancellation
  is not rollback, and these tools cannot delete records.
- Completed snapshots call for verification of recorded local completion. They never
  prove the real-world submission, payment, message or appointment happened.

Reports intentionally omit confirmation IDs/tokens/digests, record payloads, source
quotes and profile facts. Impact reports still contain exact planned titles/dates,
destination identifiers and review reason codes: keep them private. JSON strings are
inert source data; HTML consumers must escape them. Terminal formatters sanitize control
and directional characters and accept original inputs for fresh validation, rather than
trusting an edited report object's authority fields.

## Boundaries and errors

`WORKFLOW_INSIGHT_LIMITS` caps each serialized insight input at the existing workflow
snapshot byte budget, 100,000 traversed nodes, depth 32 and at most 16 prior snapshots.
Plans remain bounded by the existing 64-selection workflow limits. Strict shape,
digest and snapshot validation reject malformed or tampered input. Options are copied
before comparison. The JavaScript APIs accept inert JSON-compatible SDK data, not
hostile Proxy objects; own getters/custom serialization and cycles are rejected.
Optional SDK object properties with `undefined` are omitted as in JSON.

Digests detect inconsistency, not authenticity. Use only private host snapshots and
source-verified ledger state. Importing arbitrary JSON is not a way to create execution
authority. `observed_at` is caller-supplied time; neither report authenticates the clock,
issuer, host or record existence. No additional provider/API dependency is needed.
