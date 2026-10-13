import { fingerprint, requireValue, assertTimestamp, stableJson } from "./assistance-common.js";
import { MATOE_INTEGRATION_CONTRACT } from "./matoe-contract.generated.js";
import { LocalWorkflowCoordinator } from "./workflow-runtime.js";
import type { LocalWorkflowHost } from "./workflow-types.js";

/** Read-only report. This is neither a grant nor an importable workflow. No OCR/names/tokens. */
export interface LocalExecutionReceipt {
  receipt_version: "1.0.0";
  adapter: "actionmanifest-portable" | "matoe-native";
  plan_id: string;
  plan_digest: string;
  state: string;
  observed_at: string;
  scope: "device_local";
  real_world_completion: false;
  authorization: "none";
  steps: Array<{
    step_id: string; operation: string; status: string; destination_id: string;
    record_id: string; source_id: string; source_hash: string; action_id: string;
  }>;
}
/** Deliberately restricted JSON domain: keys are ASCII, values are strings/booleans/arrays.
 * Hashing this projection does not replace native/portable plan-digest algorithms. */
export function canonicalLocalReceipt(receipt: LocalExecutionReceipt): { json: string; sha256: string } {
  const root = ["receipt_version", "adapter", "plan_id", "plan_digest", "state", "observed_at", "scope", "real_world_completion", "authorization", "steps"];
  const fields = ["step_id", "operation", "status", "destination_id", "record_id", "source_id", "source_hash", "action_id"];
  requireValue(Object.keys(receipt).length === root.length && Object.keys(receipt).every(k => root.includes(k))
    && receipt.receipt_version === MATOE_INTEGRATION_CONTRACT.receipt_version
    && ["actionmanifest-portable", "matoe-native"].includes(receipt.adapter)
    && receipt.scope === "device_local" && receipt.real_world_completion === false && receipt.authorization === "none"
    && /^[a-f0-9]{64}$/.test(receipt.plan_digest)
    && Array.isArray(receipt.steps) && receipt.steps.length <= 64, "INVALID_RECEIPT", "Invalid non-authorizing receipt");
  assertTimestamp(receipt.observed_at);
  for (const value of [receipt.plan_id, receipt.state, ...receipt.steps.flatMap(s => Object.values(s))]) {
    requireValue(typeof value === "string" && value.length <= 1024 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value), "INVALID_RECEIPT", "Invalid receipt string");
  }
  requireValue(receipt.plan_id.length > 0 && receipt.state.length > 0 && new Set(receipt.steps.map(s => s.step_id)).size === receipt.steps.length, "INVALID_RECEIPT", "Invalid receipt identity");
  for (const step of receipt.steps) {
    requireValue(Object.keys(step).length === fields.length && Object.keys(step).every(k => fields.includes(k))
      && step.step_id.length > 0 && step.destination_id.length > 0
      && (MATOE_INTEGRATION_CONTRACT.local_operations as readonly string[]).includes(step.operation)
      && (MATOE_INTEGRATION_CONTRACT.receipt_statuses as readonly string[]).includes(step.status)
      && (step.source_hash === "" || /^[a-f0-9]{64}$/.test(step.source_hash))
      && ((step.source_id === "" && step.source_hash === "" && step.action_id === "") || (step.source_id !== "" && step.source_hash !== "" && step.action_id !== ""))
      && (step.status !== "verified" || step.record_id.length > 0), "INVALID_RECEIPT", "Invalid receipt step");
  }
  // Core stableJson already implements the same restricted sorted-key serialization.

  return { json: stableJson(receipt), sha256: fingerprint(receipt) };
}
/** Re-read actual local destinations before reporting. Never applies a local operation. */
export async function readLocalExecutionReceipt(host: LocalWorkflowHost, workflowId: string): Promise<LocalExecutionReceipt> {
  const workflow = await new LocalWorkflowCoordinator(host).verify(workflowId);
  const receipt: LocalExecutionReceipt = {
    receipt_version: "1.0.0", adapter: "actionmanifest-portable", plan_id: workflow.workflow_id,
    plan_digest: workflow.plan.digest, state: workflow.status, observed_at: host.now(), scope: "device_local",
    real_world_completion: false, authorization: "none", steps: workflow.steps.map((result, i) => {
      const step = workflow.plan.steps[i]!;
      return { step_id: step.step_id, operation: step.operation, status: result.status,
        destination_id: step.destination_id, record_id: result.record?.record_id ?? "",
        source_id: step.action_ref.source_id, source_hash: step.action_ref.source_hash, action_id: step.action_ref.action_id };
    }),
  };
  canonicalLocalReceipt(receipt); return receipt;
}
