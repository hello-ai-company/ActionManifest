export { manifestFatalReasons } from "@actionmanifest/core";
export { CONSUMABLE_STATUSES, classifyManifest, readyActions } from "./classify.js";
export type {
  ActionDisposition,
  ConsumableAction,
  ConsumerReport,
  DispositionReason,
} from "./classify.js";
export { MATOE_INPUT_LIMITS, prepareMatoeManifest } from "./matoe.js";
export type { MatoeCompatibilityBundle } from "./matoe.js";
export { prepareMatoeV02Manifest } from "./matoe-v02.js";

export { ASSISTANCE_PROTOCOL_VERSION } from "./assistance-types.js";
export type {
  ActionBinding, ActionReference, ActionRuleSet, ActionEvaluation, Applicability,
  AssistanceCompanion, AssistanceState, ChangeCard, ChangeProposal, ChangedField,
  DocumentReference, LocalFact, LocalProfile, Predicate, PredicateResult, ReviewItem,
  SourceQuote,
} from "./assistance-types.js";
export { AssistanceError, ASSISTANCE_LIMITS } from "./assistance-common.js";
export { createAssistanceState, proposeAssistanceChange, decideAssistanceChange, suggestDocumentChanges } from "./assistance-ledger.js";
export { registerAssistanceDocument } from "./assistance-ingress.js";
export { evaluatePredicate } from "./assistance-conditions.js";
export { refreshAssistance, decideAssistanceReview } from "./assistance-project.js";
export { validateAssistanceCompanion, acceptAssistanceSnapshot } from "./assistance-wire.js";
export { restoreAssistanceState } from "./assistance-persistence.js";

export { LOCAL_WORKFLOW_VERSION } from "./workflow-types.js";
export type {
  LocalOperation, LocalDestination, LocalPermission, WorkflowContext, LocalArguments,
  WorkflowSelection, LocalWorkflowStep, LocalWorkflowPlan, WorkflowStepStatus, LocalRecord,
  WorkflowStepResult, WorkflowAuthorization, LocalWorkflow, ConfirmationChallenge,
  LocalOperationCommand, LocalWorkflowHost,
} from "./workflow-types.js";
export { LOCAL_WORKFLOW_LIMITS, planLocalWorkflow, planLocalPreparation, validateLocalPlan, assertLocalPlanCurrent, workflowContextFingerprint } from "./workflow-plan.js";
export { LocalWorkflowCoordinator, LocalCommitError, restoreLocalWorkflow, localIdempotencyKey, verifyLocalRecord } from "./workflow-runtime.js";
export { MemoryLocalWorkflowHost, FileLocalWorkflowHost } from "./workflow-host.js";

export { MATOE_INTEGRATION_CONTRACT, matoeActionMapping } from "./matoe-contract.generated.js";
export { canonicalLocalReceipt, readLocalExecutionReceipt } from "./workflow-receipt.js";
export type { LocalExecutionReceipt } from "./workflow-receipt.js";

export { explainManifest, formatActionGuidance } from "./action-guidance.js";
export type { ActionGuidanceItem, ActionGuidanceReport } from "./action-guidance.js";

export { WORKFLOW_INSIGHT_LIMITS, previewLocalWorkflowImpact, adviseLocalWorkflowRecovery, formatLocalWorkflowImpact, formatLocalWorkflowRecovery } from "./workflow-insights.js";
export type { WorkflowInsightOptions, WorkflowImpactOptions, WorkflowInsightAuthority, WorkflowFreshness, LocalWorkflowImpactReport, WorkflowRecoveryAdvice, LocalWorkflowRecoveryReport } from "./workflow-insights.js";
