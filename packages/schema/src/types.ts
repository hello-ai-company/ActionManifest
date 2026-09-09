/**
 * Action Manifest v0.1 types. JSON Schema in this package is the contract;
 * these types mirror it for the TypeScript implementation.
 */

export const SCHEMA_VERSION = "0.1.0" as const;

export const ACTION_KINDS = [
  "event",
  "deadline",
  "submit",
  "prepare",
  "pay",
  "review",
  "reply",
  "sign",
  "attend",
  "contact",
  "read",
  "complete",
  "other",
] as const;

export type KnownActionKind = (typeof ACTION_KINDS)[number];
export type ActionKind = KnownActionKind | `x-${string}`;

export const MODALITIES = [
  "required",
  "recommended",
  "optional",
  "prohibited",
  "unknown",
] as const;
export type KnownModality = (typeof MODALITIES)[number];
export type Modality = KnownModality | `x-${string}`;

export type ActorCertainty = "explicit" | "implicit" | "unknown";

export const TEMPORAL_TYPES = [
  "exact",
  "approximate",
  "range",
  "relative",
  "recurring",
  "conditional",
  "unknown",
] as const;
export type TemporalType = (typeof TEMPORAL_TYPES)[number];

export type TemporalPrecision =
  | "year"
  | "month"
  | "decade_of_month"
  | "week"
  | "day"
  | "hour"
  | "minute"
  | "unknown";

export type Inference = "explicit" | "inferred";

export const REVIEW_STATUSES = [
  "proposed",
  "verified",
  "accepted",
  "rejected",
  "exported",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Evidence {
  source_id: string;
  page?: number;
  text: string;
  bbox?: BoundingBox;
  section?: string;
  source_reference?: string;
}

export interface Actor {
  text?: string;
  role?: string;
  certainty: ActorCertainty;
}

export type DeadlineQualifier =
  | "until"
  | "must_arrive"
  | "postmark_valid"
  | "on_day"
  | "later"
  | "unknown";

export interface Temporal {
  type: TemporalType;
  date?: string;
  datetime?: string;
  timezone?: string;
  precision?: TemporalPrecision;
  raw_text: string;
  certainty?: "high" | "medium" | "low" | "unknown";
  year?: number;
  month?: number;
  day?: number;
  decade?: "early" | "mid" | "late";
  start?: string;
  end?: string;
  condition?: string;
  recurrence?: string;
  deadline_qualifier?: DeadlineQualifier;
  alternatives?: Temporal[];
}

export interface Confidence {
  action?: number;
  temporal?: number;
  actor?: number;
  evidence?: number;
}

export interface Action {
  id: string;
  kind: ActionKind;
  title: string;
  description?: string;
  object?: string;
  modality: Modality;
  actor: Actor;
  temporal?: Temporal;
  evidence: Evidence[];
  confidence?: Confidence;
  inference: Inference;
  status: ReviewStatus;
  conditions?: string[];
  notes?: string;
}

export interface SourceRef {
  id: string;
  hash?: string;
  title?: string;
  uri?: string;
}

export interface VerificationIssue {
  code: string;
  message: string;
  action_id?: string;
  severity?: "error" | "warning";
}

export interface VerificationFlags {
  evidence_supported: boolean;
  temporal_supported: boolean;
  actor_supported: boolean;
  modality_supported: boolean;
  source_hash_matched: boolean;
  negation_conflict: boolean;
  page_refs_valid: boolean;
  checked_at?: string;
  issues?: VerificationIssue[];
}

export interface ExtractionReceipt {
  provider: string;
  model: string;
  extractor_version: string;
  schema_version: string;
  created_at: string;
}

export interface Receipt {
  extraction: ExtractionReceipt;
  verification?: VerificationFlags;
}

export interface ActionManifest {
  schema_version: typeof SCHEMA_VERSION | string;
  source: SourceRef;
  actions: Action[];
  receipt?: Receipt;
}

export interface CanonicalChunk {
  text: string;
  pageNumber?: number;
  bbox?: BoundingBox;
  section?: string;
  sourceReference?: string;
}

export interface CanonicalPage {
  pageNumber: number;
  text: string;
  chunks?: CanonicalChunk[];
}

export interface CanonicalDocument {
  id: string;
  sourceHash?: string;
  title?: string;
  language?: string;
  text?: string;
  pages?: CanonicalPage[];
  chunks?: CanonicalChunk[];
  metadata?: Record<string, unknown>;
}

export type { CanonicalDocument as CanonicalDocumentType };
