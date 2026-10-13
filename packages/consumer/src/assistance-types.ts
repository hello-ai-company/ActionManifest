import type { Action, ActionManifest, BoundingBox, TrustDisposition } from "@actionmanifest/core";

export const ASSISTANCE_PROTOCOL_VERSION = "0.1.0" as const;
export type Applicability = "applies" | "not_applicable" | "unknown";
export type ReviewState = "open" | "resolved" | "dismissed";
export interface DocumentReference { source_id: string; source_hash: string; action_id?: string }
export interface ActionReference extends DocumentReference { action_id: string }
export interface SourceQuote extends DocumentReference {
  text: string;
  page?: number;
  bbox?: BoundingBox;
  section?: string;
  source_reference?: string;
}
export interface ActionBinding { action_id: string; subject_key: string }

/** Internal immutable snapshot; public ingress constructs it through the v0.2 gate. */
export interface AssistanceDocument {
  source_id: string;
  source_hash: string;
  scope_key: string;
  canonical_text: string;
  manifest: ActionManifest;
  actions: Array<{ action: Action; trust: TrustDisposition; subject_key?: string }>;
}
export type ChangeKind = "corrects" | "cancels" | "possible_change";
export type TargetResolution = "exact" | "ambiguous" | "unresolved";
export interface ChangeProposal {
  change_id: string;
  kind: ChangeKind;
  before?: ActionReference;
  after: DocumentReference;
  scope_key: string;
  subject_key?: string;
  target_candidates?: ActionReference[];
  quotes: SourceQuote[];
}
export interface ChangedField {
  field: "title" | "object" | "modality" | "temporal.date" | "temporal.datetime" | "conditions";
  before_value?: string;
  after_value?: string;
}
export interface ChangeCard {
  change_id: string;
  kind: ChangeKind;
  before?: ActionReference;
  after: DocumentReference;
  quotes: SourceQuote[];
  changed_fields: ChangedField[];
  reason_codes: string[];
  target_resolution: TargetResolution;
  status: ReviewState;
}
export interface ReviewItem {
  item_id: string;
  fingerprint: string;
  action_ref?: ActionReference;
  change_id?: string;
  field: string;
  profile_id?: string;
  reason_codes: string[];
  question: string;
  quotes: SourceQuote[];
  status: ReviewState;
}
export type FactValue = string | number | boolean;
export interface LocalFact { key: string; value: FactValue; expires_at?: string }
export interface LocalProfile { profile_id: string; scope_key?: string; facts: LocalFact[] }
export type Predicate =
  | { op: "eq"; fact: string; value: FactValue }
  | { op: "in"; fact: string; values: FactValue[] }
  | { op: "all" | "any"; rules: Predicate[] }
  | { op: "not"; rule: Predicate };
export interface ActionRuleSet {
  action_ref: ActionReference;
  confirmation: "proposed" | "user_confirmed";
  audience?: Predicate;
  condition?: Predicate;
  /** Exact Action.conditions entries covered by a reviewed structured rule. */
  covers_conditions: string[];
  quotes: SourceQuote[];
}
export interface PredicateResult {
  state: Applicability;
  reason_codes: string[];
  missing_facts: string[];
  conflicting_facts: string[];
  valid_until?: string;
}
export interface ActionEvaluation {
  action_ref: ActionReference;
  profile_id: string;
  state: Applicability;
  reason_codes: string[];
  missing_facts: string[];
  workflow_state: "active" | "superseded" | "cancelled";
  trust: TrustDisposition;
  ready_for_use: boolean;
  /** Re-evaluate at or after this earliest referenced fact expiry. */
  valid_until?: string;
  date_state: "exact" | "approximate" | "relative" | "unknown" | "none";
  calendar_eligible: boolean;
}
export type AssistanceEvent =
  | { type: "document_registered"; source_id: string; source_hash: string }
  | { type: "change_proposed"; proposal: ChangeProposal }
  | { type: "change_decided"; change_id: string; decision: "apply" | "dismiss" | "reopen"; confirmed_by_user: true }
  | { type: "projection_refreshed"; fingerprint: string }
  | { type: "review_decided"; item_id: string; fingerprint: string; status: "resolved" | "dismissed" };
export interface AssistanceState {
  protocol_version: typeof ASSISTANCE_PROTOCOL_VERSION;
  ledger_id: string;
  revision: number;
  documents: AssistanceDocument[];
  events: AssistanceEvent[];
}
export interface AssistanceCompanion {
  protocol_version: typeof ASSISTANCE_PROTOCOL_VERSION;
  ledger_id: string;
  revision: number;
  changes: ChangeCard[];
  review_queue: ReviewItem[];
  evaluations: ActionEvaluation[];
}
