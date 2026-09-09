/**
 * Adversarial Document Reliability Benchmark (Phase 1.2) — evaluation only.
 *
 * These types and functions are BENCHMARK-ONLY. They MUST NOT leak into the
 * production Action Manifest schema. The oracle is the human-authored expected
 * truth in each fixture, never the current extractor output.
 *
 * The most important thing this measures is NOT how much we extract, but whether
 * we ever mark a semantically-wrong Action as `verified` (False Verified Action).
 */
import type { Action } from "@actionmanifest/core";

/** Internal benchmark failure taxonomy (never a production schema field). */
export const FAILURE_CODES = [
  "HALLUCINATED_ACTION",
  "STALE_ACTION",
  "SUPERSEDED_DATE",
  "NEGATION_LOST",
  "CONDITION_LOST",
  "WRONG_MODALITY",
  "WRONG_ACTOR",
  "WRONG_TEMPORAL",
  "CROSS_ACTION_CONTAMINATION",
  "DUPLICATE_ACTION",
  "WRONG_EVIDENCE",
  "REFERENCE_MISREAD_AS_ACTION",
  "AMBIGUITY_COLLAPSED",
  "WRONG_NEGATION_TARGET",
  "WRONG_CANCELLATION_TARGET",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export type Severity = "critical" | "high" | "medium";

/** Failure codes that represent stale / superseded / reference-only mistakes. */
const STALE_FAILURES = new Set<FailureCode>([
  "STALE_ACTION",
  "SUPERSEDED_DATE",
  "REFERENCE_MISREAD_AS_ACTION",
]);

/**
 * A pattern describing an Action that MUST NOT be produced (or, if produced,
 * MUST NOT be verified) for a given adversarial document. Benchmark-only.
 */
export interface ForbiddenPattern {
  kind?: string;
  /** Matches when this date is the primary temporal date OR any alternative. */
  date?: string;
  /** Matches ONLY the primary temporal date (ignores conditional alternatives). */
  primaryDate?: string;
  modality?: string;
  object?: string;
  titleIncludes?: string;
  /** Matches a required Action that carries no conditions/exemptions. */
  unconditionalRequired?: boolean;
  failure: FailureCode;
  severity: Severity;
  reason?: string;
}

/** Benchmark-only expected contract stored in fixture expected.json. */
export interface FixtureExpectation {
  actions: Action[];
  must_not_extract?: ForbiddenPattern[];
}

export interface ForbiddenHit {
  actionId: string;
  failure: FailureCode;
  severity: Severity;
  verified: boolean;
}

export interface AdversarialFindings {
  /** Distinct extracted Actions that matched a forbidden pattern. */
  forbiddenExtracted: number;
  /** Distinct forbidden Actions that were ALSO verified (the dangerous case). */
  forbiddenVerified: number;
  /** Distinct forbidden+verified Actions whose severity is critical. */
  criticalFalseVerified: number;
  /** Distinct stale/superseded/reference forbidden Actions extracted. */
  staleExtracted: number;
  hits: ForbiddenHit[];
}

function actionDates(a: Action): string[] {
  const out: string[] = [];
  if (a.temporal?.date) out.push(a.temporal.date);
  for (const alt of a.temporal?.alternatives ?? []) if (alt.date) out.push(alt.date);
  return out;
}

export function matchesForbidden(a: Action, p: ForbiddenPattern): boolean {
  if (p.kind && a.kind !== p.kind) return false;
  if (p.modality && a.modality !== p.modality) return false;
  if (p.date && !actionDates(a).includes(p.date)) return false;
  if (p.primaryDate && a.temporal?.date !== p.primaryDate) return false;
  if (p.object && !(a.object?.includes(p.object) || a.title.includes(p.object))) return false;
  if (p.titleIncludes && !a.title.includes(p.titleIncludes)) return false;
  if (p.unconditionalRequired && !(a.modality === "required" && (a.conditions?.length ?? 0) === 0)) {
    return false;
  }
  return true;
}

export function evaluateForbidden(
  patterns: ForbiddenPattern[],
  extracted: Action[],
  verifiedById: Map<string, boolean>,
): AdversarialFindings {
  const hits: ForbiddenHit[] = [];
  for (const a of extracted) {
    for (const p of patterns) {
      if (matchesForbidden(a, p)) {
        hits.push({
          actionId: a.id,
          failure: p.failure,
          severity: p.severity,
          verified: verifiedById.get(a.id) ?? false,
        });
      }
    }
  }
  const forbiddenIds = new Set(hits.map((h) => h.actionId));
  const verifiedIds = new Set(hits.filter((h) => h.verified).map((h) => h.actionId));
  const criticalIds = new Set(
    hits.filter((h) => h.verified && h.severity === "critical").map((h) => h.actionId),
  );
  const staleIds = new Set(hits.filter((h) => STALE_FAILURES.has(h.failure)).map((h) => h.actionId));
  return {
    forbiddenExtracted: forbiddenIds.size,
    forbiddenVerified: verifiedIds.size,
    criticalFalseVerified: criticalIds.size,
    staleExtracted: staleIds.size,
    hits,
  };
}

/** Near-duplicate Actions (same kind + object/title + date) beyond the first. */
export function countDuplicateActions(extracted: Action[]): number {
  const counts = new Map<string, number>();
  for (const a of extracted) {
    const subject = (a.object ?? a.title).replace(/\s+/g, "");
    const key = `${a.kind}|${subject}|${a.temporal?.date ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let dup = 0;
  for (const c of counts.values()) if (c > 1) dup += c - 1;
  return dup;
}

/** Every date a fixture considers semantically active (from expected.actions). */
export function expectedActiveDates(expected: FixtureExpectation): string[] {
  return expected.actions.flatMap(actionDates);
}
