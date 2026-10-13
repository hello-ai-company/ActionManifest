import { AssistanceError, assertReference, assertTimestamp, requireValue, stringValue } from "./assistance-common.js";
import { assertLocalPlanCurrent, LOCAL_WORKFLOW_LIMITS, validateLocalPlan, validateWorkflowContext } from "./workflow-plan.js";
import { localIdempotencyKey, restoreLocalWorkflow } from "./workflow-runtime.js";
import type { LocalArguments, LocalDestination, LocalOperation, LocalWorkflow, LocalWorkflowPlan, WorkflowContext, WorkflowStepStatus } from "./workflow-types.js";

export const WORKFLOW_INSIGHT_LIMITS = Object.freeze({ priorWorkflows: 16, bytes: LOCAL_WORKFLOW_LIMITS.serializedBytes, nodes: 100000, depth: 32 });
export interface WorkflowInsightOptions { now: string; context?: WorkflowContext }
export interface WorkflowImpactOptions extends WorkflowInsightOptions {
  /** Private host snapshots only. A match is historical evidence, not live record readback. */
  prior_workflows?: string[];
}
export interface WorkflowInsightAuthority {
  display_only: true; execution_allowed: false; real_world_completion: false;
  verification_basis: "supplied_snapshots_only";
}
export interface WorkflowFreshness {
  plan_time: "within_window" | "expired" | "not_yet_valid";
  context: "not_checked" | "matches_snapshot" | "not_current";
  reason_codes: string[];
}
export interface LocalWorkflowImpactReport {
  report_version: "1"; plan_id: string; observed_at: string; authority: WorkflowInsightAuthority;
  freshness: WorkflowFreshness;
  counts: { planned: number; task_creates: number; schedule_creates: number; blocked: number; review_items: number; duplicate_candidates: number };
  destinations: Array<{
    destination: LocalDestination;
    changes: Array<{ step_id: string; operation: LocalOperation; args: LocalArguments; duplicate: "none_observed" | "same_plan" | "prior_snapshot" }>;
  }>;
  blocked: Array<{ destination_id: string; operation: string; reason_codes: string[] }>;
  review_items: Array<{ item_id: string; field: string; status: string; reason_codes: string[] }>;
}
export type WorkflowRecoveryAdvice = "inspect_local_record" | "review_remaining_work" | "renew_confirmation" | "replan" | "preserve_cancelled_state" | "review_blocked_items" | "verify_recorded_completion";
export interface LocalWorkflowRecoveryReport {
  report_version: "1"; workflow_id: string; observed_at: string; snapshot_status: LocalWorkflow["status"];
  authority: WorkflowInsightAuthority; freshness: WorkflowFreshness;
  confirmation: "absent" | "unconsumed" | "expired" | "not_yet_valid" | "consumed_snapshot";
  counts: Record<WorkflowStepStatus, number>;
  advice: WorkflowRecoveryAdvice[];
  steps: Array<{ step_id: string; status: WorkflowStepStatus; advice: "inspect_local_record" | "review_failure" | "review_remaining_work" | "preserve_cancelled_state"; reason_code?: string }>;
}
const authority = (): WorkflowInsightAuthority => ({ display_only: true, execution_allowed: false, real_world_completion: false, verification_basis: "supplied_snapshots_only" });
function invalid(ok: unknown): asserts ok { requireValue(ok, "INVALID_INSIGHT_INPUT", "Invalid bounded workflow insight input"); }
/** Accept inert JSON/SDK snapshots, not adversarial JavaScript Proxies.
 * Reject accessors, cycles, sparse arrays, exotic objects and serialization hooks before cloning. */
function boundedClone<T>(input: T): T {
  let nodes = 0; let bytes = 0;
  const ancestors = new Set<object>();
  function walk(value: unknown, depth: number): void {
    invalid(++nodes <= WORKFLOW_INSIGHT_LIMITS.nodes && depth <= WORKFLOW_INSIGHT_LIMITS.depth);
    if (typeof value === "string") { bytes += Buffer.byteLength(value) + 2; invalid(bytes <= WORKFLOW_INSIGHT_LIMITS.bytes); return; }
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number") { invalid(Number.isFinite(value)); return; }
    invalid(typeof value === "object" && value !== null && !ancestors.has(value));
    invalid(Array.isArray(value) ? Object.getPrototypeOf(value) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    ancestors.add(value);
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) invalid(value.length <= WORKFLOW_INSIGHT_LIMITS.nodes && keys.length === value.length + 1);
    for (const key of keys) {
      if (Array.isArray(value) && key === "length") continue;
      invalid(typeof key === "string" && !["__proto__", "constructor", "prototype", "toJSON"].includes(key));
      if (Array.isArray(value)) invalid(/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      invalid(descriptor.enumerable && "value" in descriptor);
      bytes += Buffer.byteLength(key) + 4; invalid(bytes <= WORKFLOW_INSIGHT_LIMITS.bytes);
      // Existing SDK snapshots use optional own properties set to undefined.
      // Match JSON omission for objects only; array holes/undefined remain invalid.
      if (descriptor.value === undefined && !Array.isArray(value)) continue;
      walk(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  }
  walk(input, 0);
  const serialized = JSON.stringify(input);
  invalid(Buffer.byteLength(serialized) <= WORKFLOW_INSIGHT_LIMITS.bytes);
  return JSON.parse(serialized) as T;
}
function fields(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  invalid(value !== null && typeof value === "object" && !Array.isArray(value));
  invalid(required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => required.includes(k) || optional.includes(k)));
}
function list(value: unknown, max: number): asserts value is unknown[] { invalid(Array.isArray(value) && value.length <= max); }
function text(value: unknown, max = 256): void { stringValue(value, "workflow insight value", max); }
function integer(value: unknown): void { invalid(Number.isSafeInteger(value) && (value as number) >= 0); }
function digest(value: unknown): void { invalid(typeof value === "string" && /^[a-f0-9]{64}$/.test(value)); }
function reference(value: unknown): void { fields(value, ["source_id", "source_hash", "action_id"]); assertReference(value as never, true); }
function reasons(value: unknown): void { list(value, 128); for (const reason of value) text(reason, 256); }
function args(value: unknown, operation: LocalOperation): void {
  if (operation === "local.task.create") fields(value, ["title"], ["due_date"]);
  else { fields(value, ["title", "date", "all_day"]); invalid(value.all_day === true); }
  text(value.title, 4096);
  const date = value.date ?? value.due_date;
  if (date !== undefined) { invalid(typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)); assertTimestamp(`${date}T00:00:00Z`); }
}
function selection(value: unknown, extended = false): void {
  fields(value, ["action_ref", "operation", "destination_id", ...(extended ? ["step_id", "scope_key", "profile_id", "args", "evidence", "action_fingerprint", "binding"] : [])]);
  reference(value.action_ref); text(value.destination_id); text(value.operation);
}
function quotes(value: unknown): void {
  list(value, 32);
  for (const quote of value) {
    fields(quote, ["source_id", "source_hash", "text"], ["action_id", "page", "bbox", "section", "source_reference"]);
    assertReference(quote as never); text(quote.text, 4096);
    if (quote.page !== undefined) { integer(quote.page); invalid((quote.page as number) > 0); }
    for (const key of ["section", "source_reference"]) if (quote[key] !== undefined) text(quote[key], 4096);
    if (quote.bbox !== undefined) {
      fields(quote.bbox, ["x", "y", "width", "height"]);
      for (const n of Object.values(quote.bbox)) invalid(typeof n === "number" && Number.isFinite(n) && n >= 0);
    }
  }
}
function checkedPlan(input: LocalWorkflowPlan): LocalWorkflowPlan {
  const p = boundedClone(input);
  fields(p, ["workflow_version", "plan_id", "intent", "created_at", "expires_at", "ledger_id", "ledger_revision", "scope_key", "profile_id", "context_fingerprint", "permission_fingerprint", "destinations", "steps", "blocked", "review_items", "digest"]);
  for (const v of [p.plan_id, p.ledger_id, p.scope_key, p.profile_id]) text(v);
  text(p.intent, 2048); integer(p.ledger_revision);
  for (const v of [p.context_fingerprint, p.permission_fingerprint, p.digest]) digest(v);
  list(p.destinations, 64); list(p.steps, 64); list(p.blocked, 64); list(p.review_items, 4096);
  invalid(p.steps.length + p.blocked.length <= 64);
  for (const d of p.destinations) {
    fields(d, ["destination_id", "scope_key", "kind", "locality", "revision"]);
    text(d.destination_id); text(d.scope_key); integer(d.revision);
    invalid(d.scope_key === p.scope_key && d.locality === "device_local" && ["task_list", "schedule"].includes(d.kind));
  }
  invalid(new Set(p.destinations.map(d => d.destination_id)).size === p.destinations.length);
  for (const step of p.steps) {
    selection(step, true); text(step.step_id); text(step.scope_key); text(step.profile_id);
    invalid(["local.task.create", "local.schedule.create"].includes(step.operation));
    args(step.args, step.operation); quotes(step.evidence); digest(step.action_fingerprint); digest(step.binding);
    invalid(p.destinations.some(d => d.destination_id === step.destination_id && d.kind === (step.operation === "local.task.create" ? "task_list" : "schedule")));
  }
  invalid(p.destinations.every(d => p.steps.some(s => s.destination_id === d.destination_id)));
  for (const blocked of p.blocked) { fields(blocked, ["selection", "reason_codes"]); selection(blocked.selection); reasons(blocked.reason_codes); invalid(blocked.reason_codes.length > 0); }
  for (const review of p.review_items) {
    fields(review, ["item_id", "fingerprint", "field", "reason_codes", "question", "quotes", "status"], ["action_ref", "change_id", "profile_id"]);
    text(review.item_id); digest(review.fingerprint); text(review.field); text(review.question, 4096); reasons(review.reason_codes); quotes(review.quotes);
    invalid(["open", "resolved", "dismissed"].includes(review.status));
    if (review.action_ref) reference(review.action_ref);
    for (const v of [review.change_id, review.profile_id]) if (v !== undefined) text(v);
  }
  validateLocalPlan(p); return p;
}
function checkedWorkflow(serialized: string): LocalWorkflow {
  invalid(typeof serialized === "string" && Buffer.byteLength(serialized) <= WORKFLOW_INSIGHT_LIMITS.bytes);
  let raw: unknown;
  try { raw = JSON.parse(serialized); } catch { invalid(false); }
  const w = boundedClone(raw) as LocalWorkflow;
  fields(w, ["workflow_version", "workflow_id", "revision", "plan", "status", "steps"], ["authorization", "cancelled_at"]);
  checkedPlan(w.plan); list(w.steps, 64);
  for (const result of w.steps) {
    fields(result, ["step_id", "status", "attempts"], ["record", "verified_at", "error"]);
    if (result.verified_at !== undefined) assertTimestamp(result.verified_at);
    if (result.error !== undefined) { fields(result.error, ["code", "retryable"]); text(result.error.code); invalid(typeof result.error.retryable === "boolean"); }
    if (result.record !== undefined) {
      const r = result.record;
      fields(r, ["record_id", "idempotency_key", "workflow_id", "step_id", "binding", "operation", "destination_id", "scope_key", "args", "action_ref", "destination_revision"]);
      text(r.record_id); text(r.workflow_id); text(r.step_id); text(r.destination_id); text(r.scope_key); digest(r.idempotency_key); digest(r.binding); reference(r.action_ref);
      invalid(["local.task.create", "local.schedule.create"].includes(r.operation)); args(r.args, r.operation); integer(r.destination_revision);
    }
  }
  if (w.authorization !== undefined) {
    fields(w.authorization, ["authorization_id", "token_digest", "plan_digest", "step_ids", "issued_at", "expires_at"], ["consumed_at"]);
    text(w.authorization.authorization_id); list(w.authorization.step_ids, 64);
  }
  if (w.cancelled_at !== undefined) assertTimestamp(w.cancelled_at);
  return restoreLocalWorkflow(JSON.stringify(w));
}
function freshness(plan: LocalWorkflowPlan, options: WorkflowInsightOptions, workflow?: LocalWorkflow): WorkflowFreshness {
  assertTimestamp(options.now);
  const time = Date.parse(options.now);
  const result: WorkflowFreshness = { plan_time: time < Date.parse(plan.created_at) ? "not_yet_valid" : time >= Date.parse(plan.expires_at) ? "expired" : "within_window", context: "not_checked", reason_codes: [] };
  if (result.plan_time !== "within_window") result.reason_codes.push("PLAN_EXPIRED");
  if (options.context !== undefined) {
    const context = boundedClone(options.context);
    validateWorkflowContext(context, options.now); // Malformed contexts fail, never become reassuring advice.
    try {
      assertLocalPlanCurrent(plan, context, options.now);
      for (const destination of plan.destinations) {
        const revision = Math.max(destination.revision, ...(workflow?.steps.filter(s => s.record?.destination_id === destination.destination_id).map(s => s.record!.destination_revision) ?? []));
        requireValue(context.destinations.find(d => d.destination_id === destination.destination_id)?.revision === revision, "STALE_DESTINATION", "Destination snapshot changed");
      }
      result.context = "matches_snapshot";
    } catch (error) {
      if (!(error instanceof AssistanceError)) throw error;
      result.context = "not_current";
      if (!result.reason_codes.includes(error.code)) result.reason_codes.push(error.code);
    }
  }
  return result;
}
/** Pure snapshot preview. Exact args are inert data: escape them for HTML/terminal display.
 * Digests detect corruption, not authenticity; no host, permission or live record is modified.
 */
export function previewLocalWorkflowImpact(plan: LocalWorkflowPlan, options: WorkflowImpactOptions): LocalWorkflowImpactReport {
  const p = checkedPlan(plan); const checkedOptions = boundedClone(options);
  fields(checkedOptions, ["now"], ["context", "prior_workflows"]);
  const prior = checkedOptions.prior_workflows ?? []; list(prior, WORKFLOW_INSIGHT_LIMITS.priorWorkflows);
  const seen = new Set<string>(); const historical = new Set<string>();
  for (const serialized of prior) {
    const workflow = checkedWorkflow(serialized);
    for (const [index, result] of workflow.steps.entries()) if (result.status === "verified") historical.add(localIdempotencyKey(workflow.workflow_id, workflow.plan.steps[index]!));
  }
  const changes = p.steps.map(step => {
    const key = localIdempotencyKey(p.plan_id, step);
    const duplicate = historical.has(key) ? "prior_snapshot" as const : seen.has(key) ? "same_plan" as const : "none_observed" as const;
    seen.add(key); return { step_id: step.step_id, operation: step.operation, args: structuredClone(step.args), duplicate };
  });
  return {
    report_version: "1", plan_id: p.plan_id, observed_at: checkedOptions.now, authority: authority(), freshness: freshness(p, checkedOptions),
    counts: { planned: p.steps.length, task_creates: p.steps.filter(s => s.operation === "local.task.create").length, schedule_creates: p.steps.filter(s => s.operation === "local.schedule.create").length, blocked: p.blocked.length, review_items: p.review_items.length, duplicate_candidates: changes.filter(c => c.duplicate !== "none_observed").length },
    destinations: p.destinations.map(destination => ({ destination: structuredClone(destination), changes: changes.filter((_, i) => p.steps[i]!.destination_id === destination.destination_id) })),
    blocked: p.blocked.map(b => ({ destination_id: b.selection.destination_id, operation: b.selection.operation, reason_codes: [...b.reason_codes] })),
    review_items: p.review_items.map(r => ({ item_id: r.item_id, field: r.field, status: r.status, reason_codes: [...r.reason_codes] })),
  };
}
/** Advice only. Never invokes coordinator recovery, CAS, readback, retry or a host method. */
export function adviseLocalWorkflowRecovery(serializedWorkflow: string, options: WorkflowInsightOptions): LocalWorkflowRecoveryReport {
  const w = checkedWorkflow(serializedWorkflow); const checkedOptions = boundedClone(options);
  fields(checkedOptions, ["now"], ["context"]);
  const current = freshness(w.plan, checkedOptions, w); const auth = w.authorization; const time = Date.parse(checkedOptions.now);
  const confirmation = !auth ? "absent" : time < Date.parse(auth.issued_at) ? "not_yet_valid" : time >= Date.parse(auth.expires_at) ? "expired" : auth.consumed_at ? "consumed_snapshot" : "unconsumed";
  const counts: Record<WorkflowStepStatus, number> = { pending: 0, running: 0, verified: 0, failed: 0, uncertain: 0, cancelled: 0 };
  const advice = new Set<WorkflowRecoveryAdvice>();
  const steps = w.steps.map(s => {
    counts[s.status]++;
    const stepAdvice = ["running", "uncertain", "verified"].includes(s.status) ? "inspect_local_record" as const : w.status === "cancelled" || s.status === "cancelled" ? "preserve_cancelled_state" as const : s.status === "failed" ? "review_failure" as const : "review_remaining_work" as const;
    if (stepAdvice === "inspect_local_record") advice.add("inspect_local_record");
    return { step_id: s.step_id, status: s.status, advice: stepAdvice, ...(s.error ? { reason_code: s.error.code } : {}) };
  });
  if (w.status === "cancelled") advice.add("preserve_cancelled_state");
  else if (w.status === "completed") advice.add("verify_recorded_completion");
  else {
    if (current.plan_time !== "within_window" || current.context === "not_current") advice.add("replan");
    if (counts.pending + counts.failed + counts.running + counts.uncertain > 0) {
      advice.add("review_remaining_work");
      if (confirmation !== "consumed_snapshot" && current.plan_time === "within_window" && current.context !== "not_current") advice.add("renew_confirmation");
    }
  }
  if (w.plan.blocked.length || w.plan.review_items.length) advice.add("review_blocked_items");
  return { report_version: "1", workflow_id: w.workflow_id, observed_at: checkedOptions.now, snapshot_status: w.status, authority: authority(), freshness: current, confirmation, counts, advice: [...advice], steps };
}
const safe = (s: string): string => Array.from(s, character => {
  const point = character.codePointAt(0)!;
  return point <= 0x1f || (point >= 0x7f && point <= 0x9f) || point === 0x61c
    || point === 0x200e || point === 0x200f || (point >= 0x2028 && point <= 0x202e)
    || (point >= 0x2066 && point <= 0x2069) ? " " : character;
}).join("");
/** Format directly from inputs to prevent forged report authority fields reaching presentation. */
export function formatLocalWorkflowImpact(plan: LocalWorkflowPlan, options: WorkflowImpactOptions): string {
  const report = previewLocalWorkflowImpact(plan, options);
  const lines = ["Local workflow impact preview", "Display only. No execution authorization or real-world completion. Supplied snapshots only.", `Planned: ${report.counts.planned}; blocked: ${report.counts.blocked}; review: ${report.counts.review_items}; duplicate candidates: ${report.counts.duplicate_candidates}.`, `Plan time: ${report.freshness.plan_time}; context: ${report.freshness.context}.`];
  for (const group of report.destinations) {
    lines.push(`Destination: ${safe(group.destination.destination_id)} (${group.destination.kind}, device local)`);
    for (const change of group.changes) lines.push(`- ${safe(change.step_id)}: ${change.operation}; ${safe(JSON.stringify(change.args))}; duplicate: ${change.duplicate}`);
  }
  for (const blocked of report.blocked) lines.push(`Blocked: ${safe(blocked.destination_id)}; ${safe(blocked.reason_codes.join(", "))}`);
  for (const review of report.review_items) lines.push(`Review: ${safe(review.item_id)}; ${safe(review.reason_codes.join(", "))}`);
  lines.push("Duplicate matches are historical hints. Absence of a match does not establish that a record does not exist.");
  return lines.join("\n");
}
export function formatLocalWorkflowRecovery(serializedWorkflow: string, options: WorkflowInsightOptions): string {
  const report = adviseLocalWorkflowRecovery(serializedWorkflow, options);
  const messages: Record<WorkflowRecoveryAdvice, string> = {
    inspect_local_record: "Ask the trusted host to inspect actual local records before considering remaining work. Unknown outcomes are not failures or successes.",
    review_remaining_work: "Review exact remaining changes in the trusted host. This report grants no retry or execution permission.",
    renew_confirmation: "The trusted host must obtain fresh exact confirmation if remaining changes are to proceed, after all current checks.",
    replan: "Review current evidence, permissions and destinations and prepare a new plan. Preserve idempotency and inspect existing records first.",
    preserve_cancelled_state: "Keep cancellation in effect. Previously created records may remain; cancellation is not rollback.",
    review_blocked_items: "Review blocked selections and held review items separately. Executed steps do not complete the whole intent.",
    verify_recorded_completion: "Completion is recorded only in the supplied local snapshot. Verify current local records; real-world work is not completed by this report.",
  };
  return ["Local workflow recovery advice", "Display only. No execution authorization or real-world completion. Supplied snapshots only.", `Snapshot status: ${report.snapshot_status}; plan time: ${report.freshness.plan_time}; context: ${report.freshness.context}.`, ...report.advice.map(a => messages[a]), ...report.steps.map(s => `- ${safe(s.step_id)}: ${s.status}; ${s.advice}${s.reason_code ? `; ${safe(s.reason_code)}` : ""}`)].join("\n");
}
