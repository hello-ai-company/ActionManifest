import { matoeActionMapping } from "./matoe-contract.generated.js";
import { randomUUID } from "node:crypto";
import { assertTimestamp, findAction, findDocument, fingerprint, quotesFor, referenceKey, requireValue, stringValue } from "./assistance-common.js";
import { restoreAssistanceState } from "./assistance-persistence.js";
import { projectAssistance } from "./assistance-project.js";
import type { LocalArguments, LocalWorkflowPlan, LocalWorkflowStep, WorkflowContext, WorkflowSelection } from "./workflow-types.js";

export const LOCAL_WORKFLOW_LIMITS = Object.freeze({ steps: 64, planLifetimeMs: 24 * 60 * 60 * 1000, confirmationLifetimeMs: 5 * 60 * 1000, serializedBytes: 2 * 1024 * 1024 });
export function workflowContextFingerprint(context: WorkflowContext): string {
  return fingerprint(JSON.parse(JSON.stringify({ assistance: context.assistance, profiles: context.profiles, rules: context.rules })));
}
export function validateWorkflowContext(context: WorkflowContext, now: string): ReturnType<typeof projectAssistance> {
  assertTimestamp(now);
  // Recompute trust from the frozen manifest ingress; callers cannot bless a stored action.
  const assistance = restoreAssistanceState(JSON.stringify(context.assistance));
  requireValue(Number.isSafeInteger(context.permissions?.revision) && context.permissions.revision >= 0 && Array.isArray(context.permissions.grants) && context.permissions.grants.length <= 256, "INVALID_PERMISSION", "Invalid bounded permission snapshot");
  requireValue(Array.isArray(context.destinations) && context.destinations.length <= 64 && new Set(context.destinations.map(d => d.destination_id)).size === context.destinations.length, "INVALID_DESTINATION", "Destinations must be bounded and unique");
  for (const d of context.destinations) {
    stringValue(d.destination_id, "destination_id"); stringValue(d.scope_key, "scope_key");
    requireValue(d.locality === "device_local" && ["task_list", "schedule"].includes(d.kind) && Number.isSafeInteger(d.revision) && d.revision >= 0, "INVALID_DESTINATION", "Only revisioned device-local destinations are supported");
  }
  for (const grant of context.permissions.grants) {
    stringValue(grant.destination_id, "grant destination"); stringValue(grant.scope_key, "grant scope");
    requireValue(["local.task.create", "local.schedule.create"].includes(grant.operation), "OPERATION_DENIED", "Unknown permission operation");
  }
  return projectAssistance(assistance, context.profiles, context.rules, now);
}
export function selectionReasons(context: WorkflowContext, selection: WorkflowSelection, profileId: string, scopeKey: string, now: string): string[] {
  const companion = validateWorkflowContext(context, now);
  const reasons: string[] = [];
  if (!["local.task.create", "local.schedule.create"].includes(selection.operation)) reasons.push("OPERATION_DENIED");
  const doc = findDocument(context.assistance, selection.action_ref);
  const action = findAction(context.assistance, selection.action_ref)?.action;
  const evaluation = companion.evaluations.find(e => e.profile_id === profileId && referenceKey(e.action_ref) === referenceKey(selection.action_ref));
  if (!doc || doc.scope_key !== scopeKey || !action) reasons.push("SOURCE_SCOPE_MISMATCH");
  if (!evaluation?.ready_for_use) reasons.push(...(evaluation?.reason_codes.length ? evaluation.reason_codes : ["ACTION_NOT_READY"]));
  const destination = context.destinations.find(d => d.destination_id === selection.destination_id);
  if (!destination || destination.scope_key !== scopeKey || destination.locality !== "device_local" || destination.kind !== (selection.operation === "local.schedule.create" ? "schedule" : "task_list")) reasons.push("DESTINATION_SCOPE_MISMATCH");
  if (!context.permissions.grants.some(g => g.operation === selection.operation && g.destination_id === selection.destination_id && g.scope_key === scopeKey)) reasons.push("PERMISSION_DENIED");
  if (action && !matoeActionMapping(action.kind)) reasons.push("ACTION_KIND_REVIEW_REQUIRED");
  const temporal = action?.temporal;
  if (temporal?.datetime || temporal?.timezone || temporal?.alternatives?.length || temporal?.condition || temporal?.recurrence
    || (temporal?.type === "exact" && ((temporal.precision !== undefined && temporal.precision !== "day")
      || (temporal.start && temporal.start !== temporal.date) || (temporal.end && temporal.end !== temporal.date)
      || temporal.deadline_qualifier === "later" || temporal.deadline_qualifier === "unknown"))) reasons.push("TEMPORAL_REVIEW_REQUIRED");
  if (selection.operation === "local.schedule.create" && !evaluation?.calendar_eligible) reasons.push("SCHEDULE_DATE_REVIEW_REQUIRED");
  return [...new Set(reasons)];
}
function stepFor(context: WorkflowContext, selection: WorkflowSelection, profileId: string, scopeKey: string, index: number): LocalWorkflowStep {
  const doc = findDocument(context.assistance, selection.action_ref)!;
  const action = findAction(context.assistance, selection.action_ref)!.action;
  const date = action.temporal?.type === "exact" ? action.temporal.date ?? action.temporal.datetime?.slice(0, 10) : undefined;
  const args: LocalArguments = selection.operation === "local.schedule.create" ? { title: action.title, date: date!, all_day: true } : { title: action.title, ...(date ? { due_date: date } : {}) };
  const body = { action_ref: structuredClone(selection.action_ref), operation: selection.operation, destination_id: selection.destination_id, step_id: `step_${index + 1}`, scope_key: scopeKey, profile_id: profileId, args, evidence: quotesFor(doc, action.id), action_fingerprint: fingerprint(JSON.parse(JSON.stringify(action))) };
  return { ...body, binding: fingerprint(body) };
}
export function planLocalWorkflow(context: WorkflowContext, input: { intent: string; profile_id: string; scope_key: string; selections: WorkflowSelection[]; now: string; expires_at?: string }): LocalWorkflowPlan {
  const companion = validateWorkflowContext(context, input.now);
  stringValue(input.intent, "intent", 2048); stringValue(input.profile_id, "profile_id"); stringValue(input.scope_key, "scope_key");
  requireValue(context.profiles.some(p => p.profile_id === input.profile_id && p.scope_key === input.scope_key), "PROFILE_SCOPE_MISMATCH", "A matching local profile is required");
  requireValue(Array.isArray(input.selections) && input.selections.length <= LOCAL_WORKFLOW_LIMITS.steps, "INPUT_LIMIT", "At most 64 selections are supported");
  requireValue(new Set(input.selections.map(s => `${referenceKey(s.action_ref)}:${s.operation}:${s.destination_id}`)).size === input.selections.length, "DUPLICATE_SELECTION", "Duplicate selected action/destination");
  const expires = input.expires_at ?? new Date(Date.parse(input.now) + LOCAL_WORKFLOW_LIMITS.planLifetimeMs).toISOString();
  assertTimestamp(expires);
  requireValue(Date.parse(expires) > Date.parse(input.now) && Date.parse(expires) - Date.parse(input.now) <= LOCAL_WORKFLOW_LIMITS.planLifetimeMs, "INVALID_EXPIRY", "Plan must expire within 24 hours");
  const steps: LocalWorkflowStep[] = []; const blocked: LocalWorkflowPlan["blocked"] = [];
  for (const selection of input.selections) {
    const reasons = selectionReasons(context, selection, input.profile_id, input.scope_key, input.now);
    if (reasons.length) blocked.push({ selection: structuredClone(selection), reason_codes: reasons });
    else steps.push(stepFor(context, selection, input.profile_id, input.scope_key, steps.length));
  }
  const destinations = context.destinations.filter(d => steps.some(s => s.destination_id === d.destination_id));
  const body = {
    workflow_version: "0.1.0" as const, plan_id: randomUUID(), intent: input.intent, created_at: input.now, expires_at: expires,
    ledger_id: context.assistance.ledger_id, ledger_revision: context.assistance.revision, scope_key: input.scope_key, profile_id: input.profile_id,
    context_fingerprint: workflowContextFingerprint(context), permission_fingerprint: fingerprint(context.permissions), destinations: structuredClone(destinations),
    steps, blocked, review_items: companion.review_queue.filter(r => r.status === "open" && (!r.profile_id || r.profile_id === input.profile_id) && (!r.action_ref || findDocument(context.assistance, r.action_ref)?.scope_key === input.scope_key)),
  };
  return { ...body, digest: fingerprint(body) };
}
/** Deterministic date-window planner. Host resolves the user's timezone/week boundary.
 * Natural-language intent and evidence are inert labels; neither can name a tool.
 */
export function planLocalPreparation(context: WorkflowContext, input: { intent: string; profile_id: string; scope_key: string; start_date: string; end_date: string; task_destination_id: string; schedule_destination_id: string; now: string }): LocalWorkflowPlan {
  for (const date of [input.start_date, input.end_date]) assertTimestamp(`${date}T00:00:00Z`);
  requireValue(input.start_date < input.end_date, "INVALID_WINDOW", "Date window must be nonempty, end-exclusive");
  const selections: WorkflowSelection[] = [];
  for (const doc of context.assistance.documents) if (doc.scope_key === input.scope_key) for (const { action } of doc.actions) {
    const date = action.temporal?.type === "exact" ? action.temporal.date ?? action.temporal.datetime?.slice(0, 10) : undefined;
    if (!date || date < input.start_date || date >= input.end_date) continue;
    const isSchedule = matoeActionMapping(action.kind)?.portable_operation === "local.schedule.create";
    selections.push({ action_ref: { source_id: doc.source_id, source_hash: doc.source_hash, action_id: action.id }, operation: isSchedule ? "local.schedule.create" : "local.task.create", destination_id: isSchedule ? input.schedule_destination_id : input.task_destination_id });
  }
  return planLocalWorkflow(context, { ...input, selections });
}
export function validateLocalPlan(plan: LocalWorkflowPlan): void {
  const { digest, ...body } = plan;
  requireValue(plan.workflow_version === "0.1.0" && digest === fingerprint(body), "PLAN_TAMPERED", "Plan binding is invalid");
  requireValue(Array.isArray(plan.steps) && plan.steps.length <= LOCAL_WORKFLOW_LIMITS.steps && new Set(plan.steps.map(s => s.step_id)).size === plan.steps.length, "INVALID_PLAN", "Invalid plan steps");
  for (const step of plan.steps) {
    const { binding, ...stepBody } = step;
    requireValue(binding === fingerprint(stepBody) && step.scope_key === plan.scope_key && step.profile_id === plan.profile_id && ["local.task.create", "local.schedule.create"].includes(step.operation), "PLAN_TAMPERED", "Step binding is invalid");
  }
  assertTimestamp(plan.created_at); assertTimestamp(plan.expires_at);
  requireValue(Date.parse(plan.expires_at) > Date.parse(plan.created_at) && Date.parse(plan.expires_at) - Date.parse(plan.created_at) <= LOCAL_WORKFLOW_LIMITS.planLifetimeMs, "INVALID_EXPIRY", "Invalid plan lifetime");
}
/** Recheck ready proof against current trusted state. Destination revision is checked at commit. */
export function assertLocalPlanCurrent(plan: LocalWorkflowPlan, context: WorkflowContext, now: string): void {
  validateLocalPlan(plan); validateWorkflowContext(context, now);
  requireValue(Date.parse(now) >= Date.parse(plan.created_at) && Date.parse(now) < Date.parse(plan.expires_at), "PLAN_EXPIRED", "Replan expired or future-dated work");
  requireValue(plan.context_fingerprint === workflowContextFingerprint(context) && plan.ledger_id === context.assistance.ledger_id && plan.ledger_revision === context.assistance.revision, "STALE_CONTEXT", "Evidence, applicability, or ledger revision changed; replan");
  requireValue(plan.permission_fingerprint === fingerprint(context.permissions), "STALE_PERMISSION", "Local permissions changed; replan");
  for (const step of plan.steps) {
    const reasons = selectionReasons(context, step, plan.profile_id, plan.scope_key, now);
    requireValue(!reasons.length, reasons[0] ?? "ACTION_NOT_READY", "Action readiness changed; replan");
    const expected = stepFor(context, step, plan.profile_id, plan.scope_key, Number(step.step_id.slice(5)) - 1);
    // Select only operation/source/destination; callers must not smuggle arbitrary args.
    requireValue(step.action_fingerprint === expected.action_fingerprint && fingerprint(step.args) === fingerprint(expected.args) && fingerprint(step.evidence) === fingerprint(expected.evidence), "PLAN_TAMPERED", "Action, arguments or evidence no longer match");
  }
}
