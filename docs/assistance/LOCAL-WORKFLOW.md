# Portable local conversational workflow 0.1.0

## Scope and actual behavior

A host can implement “来週の準備をして” as a deterministic **prepare a date window**
intent. It resolves the user's local week boundary, selects a profile and source
scope, obtains a plan, displays evidence/held items/exact destinations, asks for
confirmation, and executes the confirmed local plan. `intent` is an inert label.
No LLM or general natural-language interpreter is supplied or simulated.

The only runtime allowlisted operations are:

- `local.task.create`: a local app reminder with source-derived title and optional exact due date.
- `local.schedule.create`: a local app all-day schedule record with source-derived title/date.

Task text can refer to submitting, paying, or signing. Creating its reminder does
none of those things. There are no network calls, external calendar writes, messages,
family transmissions, credential use, paid inference, deployment, or publication.
Native apps adapt these commands to their private transactional stores; this package
does not silently connect or authorize a native app. The file adapter's JSON records
are real persisted reference records, not proof of EventKit/SwiftData integration.

## Exported contract

`workflow-types.ts` exports JSON-serializable, versioned types:

- `WorkflowContext`: replay-validated `AssistanceState`, local profiles, reviewed rules,
  revisioned permissions, and explicit device-local destinations with scope/kind/revision.
- `LocalWorkflowPlan`: exact ledger/revision and context/permission fingerprints,
  profile/scope, immutable source/action/args/evidence bindings, initial destination
  revisions, proposed steps, blocked selections, and outstanding review items.
- `LocalWorkflow`: private durable journal, revision, immutable plan, exact
  authorization, workflow status, and per-step attempts/results.
- `LocalRecord`: actual local destination record plus exact source/action/argument
  binding, semantic idempotency key, originating workflow, and destination revision.

Workflow statuses: `awaiting_confirmation`, `ready`, `running`, `completed`, `partial`,
`cancelled`. Per-step statuses: `pending`, `running`, `verified`, `failed`, `uncertain`,
`cancelled`. A partial result preserves every verified record and failure reason.
Only successful actual re-reads produce `verified`; all steps must be verified and
no blocked selections or unresolved review items may remain for `completed`.
Successful selected operations with held source questions still report `partial`. A timeout or mismatched/missing read-back never counts as success.

## Minimal host integration

```ts
import {
  planLocalPreparation, FileLocalWorkflowHost, LocalWorkflowCoordinator,
} from "@actionmanifest/consumer";

const host = await FileLocalWorkflowHost.open(privateAppDatabasePath, trustedContext);
const plan = planLocalPreparation(await host.readContext(), {
  intent: "来週の準備をして", profile_id: "child-A", scope_key: "school-A",
  start_date: "2026-10-12", end_date: "2026-10-19", // end-exclusive, host-resolved local dates
  task_destination_id: "tasks-A", schedule_destination_id: "schedule-A",
  now: host.now(),
});
// Display plan.steps, evidence, exact destinations, blocked, and review_items.
const runtime = new LocalWorkflowCoordinator(host);
const workflow = await runtime.create(plan);
const challenge = await runtime.requestConfirmation(workflow.workflow_id);
// Trusted UI waits for the user's explicit confirmation of this exact display.
// Do not call confirm from an LLM/source response; never place the token in source context.
await runtime.confirm(workflow.workflow_id, challenge.token, challenge.plan_digest);
const result = await runtime.execute(workflow.workflow_id);
// Display verified records, held/failed steps and their actual reason codes.
```

`planLocalWorkflow` accepts host-selected structured actions instead of a date-window
intent. Selection is still subject to the same readiness/scope/operation policy.
No source quote can name a tool, choose an external destination, or grant permission.
UI renderers must show titles/evidence as escaped plain data, not executable HTML.

## Readiness and immutable binding

Planning, confirmation, preflight, and atomic host commit use current
`projectAssistance` and replay the frozen v0.2 ingress through
`restoreAssistanceState`. Per-action verifier success alone is insufficient:
explicit audiences and conditions need reviewed rules/current local facts;
wrong scope, pending revisions, superseded/cancelled actions, missing facts and
expired facts remain held. A queue acknowledgement does not elevate readiness.

The exact source identity/hash, full action fingerprint, quotes, operation,
arguments, destination, profile and scope bind each step. The context fingerprint
also binds the entire assistance state/profiles/rules, so even a same-revision
mutation is stale. JSON-equivalent omitted undefined fields are normalized for
persistence. Date alternatives, supplied timezones and timed datetimes require temporal review and
are held for both operation kinds. This version only creates date-only schedule
records; it does not invent times, timezones, durations, deadlines or alternatives.

Local task reminders for undated/approximate source actions can be explicitly selected
without a due date. The date-window planner omits such actions rather than guessing
they belong next week; the host should still present the assistance review queue.

Any evidence, fact, permission, action, argument or scoped destination change requires
replanning. An unrelated permission revision also invalidates the plan (conservative).
The reference host requires monotonic permission revisions and prevents scoped
destination identity reuse. Destination revisions advance with verified writes within a workflow. An unexpected
local edit prevents later writes. No live-state mutation is hidden by “success”.

## Confirmation and replay

Plans live at most 24 hours. Confirmation challenges live at most five minutes and
are capped by plan expiry. Tokens use 256 random bits; only their SHA-256 digest is
stored. The full reviewed plan digest and exact remaining step IDs are bound.
Consumption uses compare-and-swap, so double clicks and concurrent confirmations
cannot authorize a second execution. Refreshing review invalidates the old token.
An expired challenge needs a new explicit confirmation; elapsed time grants nothing.

Hashes are integrity bindings, not issuer signatures. The journal and host context
must be private trusted application state. `restoreLocalWorkflow` is not an import
endpoint for source-supplied JSON or third-party “approval”. Host code/UI must ensure
that only the user's reviewed gesture invokes `confirm`. A malicious embedding
application with full storage/API access is outside this trust boundary.

Semantic idempotency includes source/action fingerprint, operation, arguments,
profile/scope and destination, not just the workflow ID. Retries of the same workflow
re-read and reuse its record. A new plan for an already-created action fails closed
with `ALREADY_EXISTS`; it does not silently create another record or claim a different
workflow's record as its own. A future intentional-duplicate feature needs a separately
reviewed contract; changing plan IDs does not bypass this guard.

## Durable adapter obligations

`LocalWorkflowHost` defines a trusted, linearizable boundary:

1. `compareAndSwap` atomically inserts/advances private journal revisions and preserves
   plan identity. Reads and writes clone data; no mutable references escape.
2. `applyLocal` checks the current journal step/authorization/cancellation, trusted
   clock/expiry, current AssistanceState/readiness, permissions and exact destination
   revision at the **same atomic boundary** as creating a record and persisting its
   idempotency key. Preflight checks alone are insufficient.
3. Returning an already-existing key never writes twice. It must match the exact
   authorized record. Operation names remain explicitly allowlisted at commit.
4. `readLocal` must re-read actual destination state, not return a cached receipt.
5. `LocalCommitError` may only be thrown when the host knows no write happened.
   Any generic exception is treated as an unknown outcome and recovered by re-read.

`MemoryLocalWorkflowHost` implements these transactions synchronously for tests and
supports serialized restart snapshots. It is not itself durable.
`FileLocalWorkflowHost` persists real local records, workflow journal and idempotency
keys together: an exclusive directory lock, a mode-0600 temporary file, file fsync,
atomic rename and directory fsync. A reopened host revalidates the complete database.
Only private, host-selected local filesystem paths are allowed; source text must
never select the database path. Use a native database transaction in production apps.

The reference file host intentionally fails with `LOCAL_STORE_BUSY` if its lock exists.
A process crash may leave an orphan lock. The host/operator must establish that no
writer remains before recovering it; this library never steals a potentially live
lock. It makes no claim of automatic OS-process liveness detection or cross-filesystem
atomic rename support. Initialization/open failure never replaces corrupt existing data.

Limits: 64 planned steps, 256 workflows and 16,384 local records per reference database,
16 MiB database, 2 MiB workflow. Capacity is checked before mutation and full snapshot
validation precedes replacing durable bytes. Archive/rotation is an explicit host
operation, not implicit deletion by the coordinator.

## Cancellation, retry and reconciliation

`cancel` stops future atomic commits. It does not delete already-created records or
pretend to roll back them. An in-flight commit that won the atomic race may appear
as verified afterwards, while the workflow remains cancelled. A commit that lost
that race is rejected. `execute` or `verify` re-reads uncertain in-flight results.

`execute` resumes/retries incomplete work using the original semantic key and exact
unexpired authorization. Verified earlier results remain visible. After confirmation
expiry, re-read/reconciliation is still allowed, but a new mutation needs renewed
confirmation. Stale context/permission/destination errors require a new plan.
`verify` is read-only against destinations and can downgrade a former completion
when a record was changed/deleted; journal reconciliation is persisted.

## Verification evidence

`packages/consumer/src/workflow.test.ts` runs the actual PlainTextAdapter → deterministic
extractor → verifier → frozen v0.2 ingress → AssistanceState → project readiness →
plan → confirmation → local execution → actual re-read pipeline. It covers conditions,
scope, injection-like text, immutable arguments, token replay/expiry, CAS races,
permission revocation at commit, fact expiry, cancellation races, partial failures,
post-commit response loss, restart recovery, incorrect receipts, missing records,
semantic duplicates, actual file durability/reopen, orphan locks, corruption and
capacity. Deterministic extraction is explicitly used; no model inference is faked.

The built-package integration `integration/reference-consumer/test/local-workflow.test.ts`
also invokes the real `analyze-matoe --stdin-json` CLI and abruptly exits a separate
Node process after a file commit but before journal acknowledgement. A new host
instance recovers the persisted running step and completes without a duplicate.
Reference filesystem durability has been exercised on Linux; production hosts must
verify their own filesystem/database atomicity and durability guarantees.
