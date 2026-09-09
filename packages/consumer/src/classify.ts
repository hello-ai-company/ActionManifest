import { manifestFatalReasons } from "@actionmanifest/core";
import type {
  Action,
  ActionManifest,
  ActionVerificationResult,
  VerificationFlags,
} from "@actionmanifest/core";

/**
 * Reference consumer policy (Phase 2).
 *
 * Third-party applications MUST NOT treat `status === "verified"` alone as
 * sufficient: an Action is consumable only when its per-Action verification
 * passed AND there is no manifest-level fatal condition. This module is the
 * reference implementation of that policy. It classifies; it never executes.
 *
 * Dispositions:
 * - `ready` — per-Action verification passed, no manifest-level fatal, and the
 *   Action's status is in the verified lifecycle tier (verified/accepted/
 *   exported). Safe to consume.
 * - `review_required` — trust cannot be established from the receipt alone
 *   (verification missing, v0.1 aggregate-only receipt with failures, or a
 *   passed-but-not-promoted oddity). A human must review before use.
 * - `blocked` — verification failed for this Action, a human rejected it, or
 *   a manifest-level fatal poisons the whole document. Do not use.
 */
export type ActionDisposition = "ready" | "review_required" | "blocked";

export interface DispositionReason {
  code: string;
  message: string;
}

export interface ConsumableAction {
  action: Action;
  disposition: ActionDisposition;
  reasons: DispositionReason[];
  /** The per-Action verification result when the receipt carries one (v0.2). */
  verification?: ActionVerificationResult;
}

export interface ConsumerReport {
  /** True when a manifest-level fatal condition was detected from the receipt. */
  manifestFatal: boolean;
  fatalReasons: DispositionReason[];
  actions: ConsumableAction[];
  counts: Record<ActionDisposition, number>;
}

/** Statuses a verified Action may be in when consumed downstream. */
export const CONSUMABLE_STATUSES = ["verified", "accepted", "exported"] as const;

function reason(code: string, message: string): DispositionReason {
  return { code, message };
}

function errorReasons(result: ActionVerificationResult): DispositionReason[] {
  const errors = result.issues.filter((i) => (i.severity ?? "error") === "error");
  return errors.map((i) => reason(i.code, i.message));
}

function classifyOne(
  action: Action,
  flags: VerificationFlags | undefined,
  fatal: DispositionReason[],
): ConsumableAction {
  if (fatal.length > 0) {
    return { action, disposition: "blocked", reasons: fatal };
  }
  if (action.status === "rejected") {
    return {
      action,
      disposition: "blocked",
      reasons: [reason("ACTION_REJECTED", "Action was rejected during review")],
    };
  }
  if (!flags) {
    return {
      action,
      disposition: "review_required",
      reasons: [
        reason(
          "VERIFICATION_MISSING",
          "manifest carries no verification receipt; run verifyManifest before consuming",
        ),
      ],
    };
  }

  const result = (flags.actions ?? []).find((r) => r.action_id === action.id);
  if (!result) {
    // v0.1 receipts have no per-Action results: the aggregate booleans are an
    // AND across all Actions, so "all true" means this Action passed. Any
    // failure cannot be attributed to a specific Action → review, never block
    // everything and never trust anything silently.
    const aggregateOk =
      flags.evidence_supported &&
      flags.temporal_supported &&
      flags.actor_supported &&
      flags.modality_supported &&
      flags.source_hash_matched &&
      !flags.negation_conflict &&
      flags.page_refs_valid &&
      !(flags.issues ?? []).some((i) => (i.severity ?? "error") === "error");
    if (aggregateOk && (CONSUMABLE_STATUSES as readonly string[]).includes(action.status)) {
      return { action, disposition: "ready", reasons: [] };
    }
    if (aggregateOk && action.status === "proposed") {
      // Legacy v0.1 manifests verified as a whole were not always promoted.
      return {
        action,
        disposition: "review_required",
        reasons: [
          reason(
            "PASSED_NOT_PROMOTED",
            "aggregate verification passed but the Action status was never promoted to verified",
          ),
        ],
      };
    }
    return {
      action,
      disposition: "review_required",
      reasons: [
        reason(
          "PER_ACTION_RESULT_MISSING",
          "receipt has no per-Action results and the aggregate verification is not clean; cannot attribute trust to this Action",
        ),
      ],
    };
  }

  if (!result.passed) {
    const reasons = errorReasons(result);
    return {
      action,
      disposition: "blocked",
      reasons: reasons.length
        ? reasons
        : [reason("VERIFICATION_FAILED", "per-Action verification failed")],
      verification: result,
    };
  }
  if ((CONSUMABLE_STATUSES as readonly string[]).includes(action.status)) {
    const warnings = result.issues
      .filter((i) => i.severity === "warning")
      .map((i) => reason(i.code, i.message));
    return { action, disposition: "ready", reasons: warnings, verification: result };
  }
  return {
    action,
    disposition: "review_required",
    reasons: [
      reason(
        "PASSED_NOT_PROMOTED",
        `per-Action verification passed but status is "${action.status}", not a verified-tier status`,
      ),
    ],
    verification: result,
  };
}

/**
 * Classify every Action of a verified (or unverified) manifest for safe
 * consumption. Pure function of the manifest + its receipt; no I/O.
 */
export function classifyManifest(manifest: ActionManifest): ConsumerReport {
  const flags = manifest.receipt?.verification;
  const fatal = flags ? manifestFatalReasons(flags) : [];
  const actions = manifest.actions.map((a) => classifyOne(a, flags, fatal));
  const counts: Record<ActionDisposition, number> = { ready: 0, review_required: 0, blocked: 0 };
  for (const a of actions) counts[a.disposition] += 1;
  return { manifestFatal: fatal.length > 0, fatalReasons: fatal, actions, counts };
}

/** Convenience: the Actions safe to consume right now. */
export function readyActions(manifest: ActionManifest): Action[] {
  return classifyManifest(manifest)
    .actions.filter((a) => a.disposition === "ready")
    .map((a) => a.action);
}
