import type { ActionReference, ActionRuleSet, AssistanceState, LocalProfile, ReviewItem, SourceQuote } from "./assistance-types.js";

/** This protocol only creates local app records. It never submits, pays, signs or sends. */
export const LOCAL_WORKFLOW_VERSION = "0.1.0" as const;
export type LocalOperation = "local.task.create" | "local.schedule.create";
export interface LocalDestination {
  destination_id: string;
  scope_key: string;
  kind: "task_list" | "schedule";
  locality: "device_local";
  revision: number;
}
export interface LocalPermission {
  revision: number;
  grants: Array<{ destination_id: string; scope_key: string; operation: LocalOperation }>;
}
export interface WorkflowContext {
  assistance: AssistanceState;
  profiles: LocalProfile[];
  rules: ActionRuleSet[];
  permissions: LocalPermission;
  destinations: LocalDestination[];
}
export type LocalArguments =
  | { title: string; due_date?: string }
  | { title: string; date: string; all_day: true };
export interface WorkflowSelection {
  action_ref: ActionReference;
  operation: LocalOperation;
  destination_id: string;
}
export interface LocalWorkflowStep extends WorkflowSelection {
  step_id: string;
  scope_key: string;
  profile_id: string;
  args: LocalArguments;
  evidence: SourceQuote[];
  action_fingerprint: string;
  binding: string;
}
export interface LocalWorkflowPlan {
  workflow_version: typeof LOCAL_WORKFLOW_VERSION;
  plan_id: string;
  intent: string;
  created_at: string;
  expires_at: string;
  ledger_id: string;
  ledger_revision: number;
  scope_key: string;
  profile_id: string;
  context_fingerprint: string;
  permission_fingerprint: string;
  destinations: LocalDestination[];
  steps: LocalWorkflowStep[];
  blocked: Array<{ selection: WorkflowSelection; reason_codes: string[] }>;
  review_items: ReviewItem[];
  digest: string;
}
export type WorkflowStepStatus = "pending" | "running" | "verified" | "failed" | "uncertain" | "cancelled";
export interface LocalRecord {
  record_id: string;
  idempotency_key: string;
  workflow_id: string;
  step_id: string;
  binding: string;
  operation: LocalOperation;
  destination_id: string;
  scope_key: string;
  args: LocalArguments;
  action_ref: ActionReference;
  destination_revision: number;
}
export interface WorkflowStepResult {
  step_id: string;
  status: WorkflowStepStatus;
  attempts: number;
  record?: LocalRecord;
  verified_at?: string;
  error?: { code: string; retryable: boolean };
}
export interface WorkflowAuthorization {
  authorization_id: string;
  token_digest: string;
  plan_digest: string;
  step_ids: string[];
  issued_at: string;
  expires_at: string;
  consumed_at?: string;
}
export interface LocalWorkflow {
  workflow_version: typeof LOCAL_WORKFLOW_VERSION;
  workflow_id: string;
  revision: number;
  plan: LocalWorkflowPlan;
  status: "awaiting_confirmation" | "ready" | "running" | "completed" | "partial" | "cancelled";
  steps: WorkflowStepResult[];
  authorization?: WorkflowAuthorization;
  cancelled_at?: string;
}
export interface ConfirmationChallenge {
  workflow_id: string;
  plan_digest: string;
  token: string;
  expires_at: string;
  step_ids: string[];
}
export interface LocalOperationCommand {
  workflow_id: string;
  step: LocalWorkflowStep;
  authorization_id: string;
  plan_digest: string;
  context_fingerprint: string;
  permission_fingerprint: string;
  expected_destination_revision: number;
  idempotency_key: string;
}
/** Trusted host boundary. Implementations must durably/atomically enforce these contracts.
 * Storage is private local app storage, not an externally writable JSON document.
 */
export interface LocalWorkflowHost {
  now(): string;
  readContext(): Promise<WorkflowContext>;
  load(workflowId: string): Promise<LocalWorkflow | undefined>;
  /** Atomic insert/CAS; clone both inputs/outputs, reject stale revision. */
  compareAndSwap(workflowId: string, expectedRevision: number | null, next: LocalWorkflow): Promise<boolean>;
  /** Linearizable local commit: validate journal authorization/cancellation, current context,
   * permission and destination revisions at the SAME atomic boundary as record creation;
   * persist idempotency key with record. Replaying key must return the same record.
   * Never dispatch arbitrary tools, external services, URLs, or code from source text.
   */
  applyLocal(command: LocalOperationCommand): Promise<LocalRecord>;
  /** Re-read the actual destination record, not a cached success receipt. */
  readLocal(destinationId: string, idempotencyKey: string): Promise<LocalRecord | undefined>;
}
