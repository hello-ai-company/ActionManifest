import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AssistanceError, assertTimestamp, fingerprint, hashText, requireValue } from "./assistance-common.js";
import { assertLocalPlanCurrent, LOCAL_WORKFLOW_LIMITS, validateLocalPlan } from "./workflow-plan.js";
import type { ConfirmationChallenge, LocalOperationCommand, LocalRecord, LocalWorkflow, LocalWorkflowHost, LocalWorkflowPlan, LocalWorkflowStep, WorkflowStepResult } from "./workflow-types.js";

/** Only host adapters may assert that a failed commit definitely had no side effect. */
export class LocalCommitError extends AssistanceError {
  constructor(code: string, readonly retryable: boolean, message: string) { super(code, message); }
}
export function localIdempotencyKey(_workflowId: string, step: LocalWorkflowStep): string {
  // Semantic identity also prevents duplicate creation through a newly generated plan.
  return fingerprint({ action_ref: step.action_ref, action_fingerprint: step.action_fingerprint, operation: step.operation, args: step.args, destination_id: step.destination_id, profile_id: step.profile_id, scope_key: step.scope_key });
}
export function verifyLocalRecord(record: LocalRecord, workflow: LocalWorkflow, step: LocalWorkflowStep): boolean {
  return typeof record.record_id === "string" && record.record_id.length > 0 && record.idempotency_key === localIdempotencyKey(workflow.workflow_id, step)
    && record.workflow_id === workflow.workflow_id && record.step_id === step.step_id && record.binding === step.binding
    && record.operation === step.operation && record.destination_id === step.destination_id && record.scope_key === step.scope_key
    && fingerprint(record.args) === fingerprint(step.args) && fingerprint(record.action_ref) === fingerprint(step.action_ref)
    && Number.isSafeInteger(record.destination_revision) && record.destination_revision > 0;
}
function intentComplete(workflow: LocalWorkflow): boolean {
  return workflow.steps.every(s => s.status === "verified") && workflow.plan.blocked.length === 0 && workflow.plan.review_items.length === 0;
}
/** Validation of private host snapshots, not authentication of arbitrary imported JSON. */
export function restoreLocalWorkflow(serialized: string): LocalWorkflow {
  requireValue(typeof serialized === "string" && Buffer.byteLength(serialized) <= LOCAL_WORKFLOW_LIMITS.serializedBytes, "INPUT_LIMIT", "Workflow snapshot exceeds limit");
  const workflow = JSON.parse(serialized) as LocalWorkflow;
  validateLocalPlan(workflow.plan);
  requireValue(workflow.workflow_version === "0.1.0" && workflow.workflow_id === workflow.plan.plan_id && Number.isSafeInteger(workflow.revision) && workflow.revision >= 0, "INVALID_WORKFLOW", "Invalid workflow identity or revision");
  requireValue(["awaiting_confirmation", "ready", "running", "completed", "partial", "cancelled"].includes(workflow.status) && Array.isArray(workflow.steps) && workflow.steps.length === workflow.plan.steps.length, "INVALID_WORKFLOW", "Invalid workflow status or steps");
  for (const [index, result] of workflow.steps.entries()) {
    const step = workflow.plan.steps[index]!;
    requireValue(result.step_id === step.step_id && ["pending", "running", "verified", "failed", "uncertain", "cancelled"].includes(result.status) && Number.isSafeInteger(result.attempts) && result.attempts >= 0, "INVALID_WORKFLOW", "Invalid step state");
    if (result.record) requireValue(verifyLocalRecord(result.record, workflow, step), "INVALID_RECORD", "Stored result does not match the exact step");
    if (result.status === "verified") { requireValue(result.record && result.verified_at, "INVALID_WORKFLOW", "Verified result needs a record and timestamp"); assertTimestamp(result.verified_at); }
  }
  if (workflow.authorization) {
    const auth = workflow.authorization;
    requireValue(auth.plan_digest === workflow.plan.digest && /^[a-f0-9]{64}$/.test(auth.token_digest) && typeof auth.authorization_id === "string" && auth.authorization_id.length > 0 && Array.isArray(auth.step_ids) && auth.step_ids.length > 0 && new Set(auth.step_ids).size === auth.step_ids.length && auth.step_ids.every(id => workflow.plan.steps.some(s => s.step_id === id)), "INVALID_AUTHORIZATION", "Invalid exact authorization binding");
    assertTimestamp(auth.issued_at); assertTimestamp(auth.expires_at);
    requireValue(Date.parse(auth.expires_at) > Date.parse(auth.issued_at) && Date.parse(auth.expires_at) - Date.parse(auth.issued_at) <= LOCAL_WORKFLOW_LIMITS.confirmationLifetimeMs, "INVALID_AUTHORIZATION", "Invalid confirmation lifetime");
    if (auth.consumed_at) { assertTimestamp(auth.consumed_at); requireValue(Date.parse(auth.consumed_at) >= Date.parse(auth.issued_at) && Date.parse(auth.consumed_at) < Date.parse(auth.expires_at), "INVALID_AUTHORIZATION", "Confirmation consumed outside lifetime"); }
  }
  if (["ready", "running", "completed"].includes(workflow.status)) requireValue(workflow.authorization?.consumed_at, "INVALID_AUTHORIZATION", "Execution requires consumed confirmation");
  if (workflow.status === "completed") requireValue(intentComplete(workflow), "INVALID_WORKFLOW", "Completion requires verified results and no held review items");
  if (workflow.status === "cancelled") { requireValue(workflow.cancelled_at, "INVALID_WORKFLOW", "Cancelled workflow needs timestamp"); assertTimestamp(workflow.cancelled_at); }
  return structuredClone(workflow);
}
export class LocalWorkflowCoordinator {
  constructor(private readonly host: LocalWorkflowHost) {}
  private async read(id: string): Promise<LocalWorkflow> {
    const value = await this.host.load(id);
    requireValue(value, "WORKFLOW_NOT_FOUND", "Workflow not found");
    return restoreLocalWorkflow(JSON.stringify(value));
  }
  private async save(previous: LocalWorkflow, next: LocalWorkflow): Promise<LocalWorkflow> {
    next.revision = previous.revision + 1;
    const checked = restoreLocalWorkflow(JSON.stringify(next));
    requireValue(await this.host.compareAndSwap(previous.workflow_id, previous.revision, checked), "WORKFLOW_CONFLICT", "Concurrent workflow update; reload");
    return checked;
  }
  async create(plan: LocalWorkflowPlan): Promise<LocalWorkflow> {
    const context = await this.host.readContext();
    assertLocalPlanCurrent(plan, context, this.host.now());
    requireValue(plan.steps.length > 0, "NOTHING_READY", "Resolve the review queue before creating an executable workflow");
    for (const destination of plan.destinations) requireValue(context.destinations.find(d => d.destination_id === destination.destination_id)?.revision === destination.revision, "STALE_DESTINATION", "Destination changed; replan");
    const workflow: LocalWorkflow = { workflow_version: "0.1.0", workflow_id: plan.plan_id, revision: 0, plan: structuredClone(plan), status: "awaiting_confirmation", steps: plan.steps.map(s => ({ step_id: s.step_id, status: "pending", attempts: 0 })) };
    requireValue(await this.host.compareAndSwap(workflow.workflow_id, null, workflow), "WORKFLOW_EXISTS", "The plan already has a workflow; reload it");
    return structuredClone(workflow);
  }
  /** Call only from trusted user-facing review UI, displaying exact steps/evidence/destinations. */
  async requestConfirmation(id: string): Promise<ConfirmationChallenge> {
    const previous = await this.read(id);
    requireValue(previous.status !== "cancelled" && previous.status !== "completed" && previous.status !== "running", "INVALID_TRANSITION", "Cannot confirm this workflow state");
    assertLocalPlanCurrent(previous.plan, await this.host.readContext(), this.host.now());
    const token = randomBytes(32).toString("base64url"); const now = this.host.now();
    const expires_at = new Date(Math.min(Date.parse(now) + LOCAL_WORKFLOW_LIMITS.confirmationLifetimeMs, Date.parse(previous.plan.expires_at))).toISOString();
    const step_ids = previous.steps.filter(s => s.status !== "verified" && s.status !== "cancelled").map(s => s.step_id);
    requireValue(step_ids.length > 0, "NOTHING_READY", "No uncompleted steps remain");
    const next = structuredClone(previous);
    next.status = "awaiting_confirmation";
    next.authorization = { authorization_id: randomUUID(), token_digest: hashText(token), plan_digest: next.plan.digest, step_ids, issued_at: now, expires_at };
    await this.save(previous, next);
    return { workflow_id: id, plan_digest: next.plan.digest, token, expires_at, step_ids };
  }
  async confirm(id: string, token: string, displayedPlanDigest: string): Promise<LocalWorkflow> {
    const previous = await this.read(id); const auth = previous.authorization; const now = this.host.now();
    requireValue(previous.status === "awaiting_confirmation" && auth && !auth.consumed_at, "CONFIRMATION_REPLAY", "Confirmation is absent, consumed, or invalidated");
    requireValue(typeof token === "string" && token.length <= 128 && timingSafeEqual(Buffer.from(hashText(token)), Buffer.from(auth.token_digest)) && displayedPlanDigest === previous.plan.digest, "CONFIRMATION_MISMATCH", "Confirmation must match the reviewed plan exactly");
    requireValue(Date.parse(now) >= Date.parse(auth.issued_at) && Date.parse(now) < Date.parse(auth.expires_at), "CONFIRMATION_EXPIRED", "Review and confirm again");
    assertLocalPlanCurrent(previous.plan, await this.host.readContext(), now);
    const next = structuredClone(previous); next.authorization!.consumed_at = now; next.status = "ready";
    return this.save(previous, next);
  }
  /** Cancellation prevents future commits. Already created records remain and are reported. */
  async cancel(id: string): Promise<LocalWorkflow> {
    const previous = await this.read(id);
    if (previous.status === "cancelled" || previous.status === "completed") return previous;
    const next = structuredClone(previous); next.status = "cancelled"; next.cancelled_at = this.host.now();
    for (const result of next.steps) if (!["verified", "running", "uncertain"].includes(result.status)) result.status = "cancelled";
    return this.save(previous, next);
  }
  private async updateResult(id: string, stepId: string, result: WorkflowStepResult): Promise<LocalWorkflow> {
    // Bounded CAS retries only for journal contention, never replay an external operation.
    for (let i = 0; i < 8; i++) {
      const previous = await this.read(id); const next = structuredClone(previous);
      const index = next.steps.findIndex(s => s.step_id === stepId);
      next.steps[index] = result;
      if (next.status === "cancelled" && !["verified", "uncertain"].includes(result.status)) next.steps[index]!.status = "cancelled";
      try { return await this.save(previous, next); } catch (error) { if (!(error instanceof AssistanceError) || error.code !== "WORKFLOW_CONFLICT") throw error; }
    }
    throw new AssistanceError("WORKFLOW_CONFLICT", "Concurrent updates did not settle; reload");
  }
  /** Execute or recover. Each retry uses the original idempotency key; recovery reads first.
   * A timeout is uncertain, never success. Confirmation may be renewed for remaining work.
   */
  async execute(id: string): Promise<LocalWorkflow> {
    let workflow = await this.read(id);
    requireValue(workflow.authorization?.consumed_at || workflow.status === "cancelled", "CONFIRMATION_REQUIRED", "Exact user confirmation is required");
    if (workflow.status === "completed") return this.verify(id);
    for (const step of workflow.plan.steps) {
      workflow = await this.read(id);
      const result = workflow.steps.find(s => s.step_id === step.step_id)!;
      const key = localIdempotencyKey(id, step);
      // Always re-read before retries, including recovery after token expiry/cancellation.
      let existing: LocalRecord | undefined;
      try { existing = await this.host.readLocal(step.destination_id, key); }
      catch { await this.updateResult(id, step.step_id, { ...result, status: "uncertain", error: { code: "READBACK_FAILED", retryable: true } }); break; }
      if (existing) {
        const valid = verifyLocalRecord(existing, workflow, step);
        await this.updateResult(id, step.step_id, { ...result, status: valid ? "verified" : existing.workflow_id !== id ? "failed" : "uncertain", ...(valid ? { record: existing, verified_at: this.host.now(), error: undefined } : { error: { code: existing.workflow_id !== id ? "ALREADY_EXISTS" : "READBACK_MISMATCH", retryable: false } }) });
        if (!valid && existing.workflow_id === id) break;
        continue;
      }
      if (workflow.status === "cancelled" || result.status === "cancelled") { if (result.status !== "cancelled") await this.updateResult(id, step.step_id, { ...result, status: "cancelled", record: undefined, verified_at: undefined }); continue; }
      if (result.status === "verified") { await this.updateResult(id, step.step_id, { ...result, status: "uncertain", record: undefined, verified_at: undefined, error: { code: "RECORD_MISSING", retryable: false } }); break; }
      if (result.error?.retryable === false) continue;
      try {
        const auth = workflow.authorization; const now = this.host.now();
        requireValue(auth?.consumed_at && auth.step_ids.includes(step.step_id) && Date.parse(now) < Date.parse(auth.expires_at), "CONFIRMATION_EXPIRED", "Confirm remaining work again");
        const context = await this.host.readContext(); assertLocalPlanCurrent(workflow.plan, context, now);
        const initialDestination = workflow.plan.destinations.find(d => d.destination_id === step.destination_id)!;
        const destinationRevision = Math.max(initialDestination.revision, ...workflow.steps.filter(s => s.record?.destination_id === step.destination_id).map(s => s.record!.destination_revision));
        requireValue(context.destinations.find(d => d.destination_id === step.destination_id)?.revision === destinationRevision, "STALE_DESTINATION", "Destination changed; replan");
        const next = structuredClone(workflow); next.status = "running";
        const running = { ...result, status: "running" as const, attempts: result.attempts + 1, error: undefined };
        next.steps[next.steps.findIndex(s => s.step_id === step.step_id)] = running;
        workflow = await this.save(workflow, next);
        const command: LocalOperationCommand = { workflow_id: id, step, authorization_id: auth.authorization_id, plan_digest: workflow.plan.digest, context_fingerprint: workflow.plan.context_fingerprint, permission_fingerprint: workflow.plan.permission_fingerprint, expected_destination_revision: destinationRevision, idempotency_key: key };
        try {
          await this.host.applyLocal(command);
          // The receipt is deliberately ignored: success comes only from actual re-read.
          const actual = await this.host.readLocal(step.destination_id, key);
          if (!actual || !verifyLocalRecord(actual, workflow, step)) {
            await this.updateResult(id, step.step_id, { ...running, status: "uncertain", error: { code: "READBACK_MISMATCH", retryable: true } }); break;
          }
          await this.updateResult(id, step.step_id, { ...running, status: "verified", record: actual, verified_at: this.host.now() });
        } catch (error) {
          await this.updateResult(id, step.step_id, { ...running, status: error instanceof LocalCommitError ? "failed" : "uncertain", error: { code: error instanceof LocalCommitError ? error.code : "COMMIT_OUTCOME_UNKNOWN", retryable: error instanceof LocalCommitError ? error.retryable : true } });
          break;
        }
      } catch (error) {
        if (error instanceof AssistanceError && error.code === "WORKFLOW_CONFLICT") return this.read(id);
        await this.updateResult(id, step.step_id, { ...result, status: "failed", error: { code: error instanceof AssistanceError ? error.code : "PRECONDITION_FAILED", retryable: error instanceof AssistanceError && error.code === "CONFIRMATION_EXPIRED" } });
        break;
      }
    }
    workflow = await this.read(id);
    if (workflow.status === "cancelled") return workflow;
    const next = structuredClone(workflow); next.status = intentComplete(next) ? "completed" : "partial";
    try { return await this.save(workflow, next); } catch (error) { if (error instanceof AssistanceError && error.code === "WORKFLOW_CONFLICT") return this.read(id); throw error; }
  }
  /** Read-only reconciliation, including already-completed or cancelled workflows. */
  async verify(id: string): Promise<LocalWorkflow> {
    let workflow = await this.read(id);
    for (const step of workflow.plan.steps) {
      const result = workflow.steps.find(s => s.step_id === step.step_id)!;
      if (!["verified", "running", "uncertain"].includes(result.status)) continue;
      let record: LocalRecord | undefined;
      try { record = await this.host.readLocal(step.destination_id, localIdempotencyKey(id, step)); } catch { /* Unknown read outcome stays uncertain. */ }
      const valid = record && verifyLocalRecord(record, workflow, step);
      const next = structuredClone(workflow);
      next.steps[next.steps.findIndex(s => s.step_id === step.step_id)] = valid ? { ...result, status: "verified", record, verified_at: this.host.now(), error: undefined } : { ...result, status: "uncertain", record: undefined, verified_at: undefined, error: { code: "READBACK_MISMATCH", retryable: false } };
      if (next.status !== "cancelled") next.status = intentComplete(next) ? "completed" : "partial";
      workflow = await this.save(workflow, next);
    }
    return workflow;
  }
}
