import type {
  Action,
  VerificationFlags,
  VerificationIssue,
} from "@actionmanifest/schema";
import { manifestFatalReasons, type FatalReason } from "./receipt.js";

/**
 * Shared Action trust policy (Phase 2 pre-merge hardening).
 *
 * ONE source of truth for "is this Action safe to consume?" — used by the
 * reference consumer (classification) and the exporters (filtering), so a
 * consumer and an exporter can never disagree. Status alone is NOT trust:
 * an Action is trusted only when the verification receipt proves the
 * per-Action checks passed AND there is no manifest-level fatal condition
 * AND the lifecycle status is in the verified tier.
 *
 * Trust order: receipt truth > lifecycle status > export convenience.
 */
export type ActionTrustReason =
  | "READY"
  | "MANIFEST_FATAL"
  | "VERIFICATION_MISSING"
  | "PER_ACTION_RESULT_MISSING"
  | "VERIFICATION_FAILED"
  | "STATUS_NOT_VERIFIED_TIER"
  | "ACTION_REJECTED";

/** Shared disposition vocabulary derived from the trust reason. */
export type TrustDisposition = "ready" | "review_required" | "blocked";

export interface ActionTrustResult {
  /** True only when the Action is safe to consume/export by default. */
  ready: boolean;
  reason: ActionTrustReason;
  message: string;
  /**
   * Per-Action issues: error issues when reason is VERIFICATION_FAILED,
   * warning issues when READY (a ready Action may still carry warnings).
   */
  issues?: VerificationIssue[];
  /** Manifest-level fatal reasons, present when reason is MANIFEST_FATAL. */
  fatal?: FatalReason[];
}

/** Lifecycle statuses treated as verified for trust purposes. */
export const VERIFIED_TIER_STATUSES = ["verified", "accepted", "exported"] as const;

export function isVerifiedTierStatus(status: string): boolean {
  return (VERIFIED_TIER_STATUSES as readonly string[]).includes(status);
}

export function trustDispositionFor(reason: ActionTrustReason): TrustDisposition {
  switch (reason) {
    case "READY":
      return "ready";
    case "MANIFEST_FATAL":
    case "ACTION_REJECTED":
    case "VERIFICATION_FAILED":
      return "blocked";
    case "VERIFICATION_MISSING":
    case "PER_ACTION_RESULT_MISSING":
    case "STATUS_NOT_VERIFIED_TIER":
      return "review_required";
  }
}

/**
 * v0.1 receipts carry no per-Action results: the aggregate booleans are an
 * AND across all Actions, so "all clean" implies every Action passed. Any
 * aggregate failure cannot be attributed to a specific Action.
 */
function aggregateClean(flags: VerificationFlags): boolean {
  return (
    flags.evidence_supported &&
    flags.temporal_supported &&
    flags.actor_supported &&
    flags.modality_supported &&
    flags.source_hash_matched &&
    !flags.negation_conflict &&
    flags.page_refs_valid &&
    !(flags.issues ?? []).some((i) => (i.severity ?? "error") === "error")
  );
}

function result(
  ready: boolean,
  reason: ActionTrustReason,
  message: string,
  extra?: Pick<ActionTrustResult, "issues" | "fatal">,
): ActionTrustResult {
  return { ready, reason, message, ...extra };
}

/**
 * Evaluate whether a single Action is trustworthy, from the manifest's
 * verification receipt plus the Action's lifecycle status. Pure function;
 * no I/O. Never throws on missing data — missing data means untrusted.
 */
export function evaluateActionTrust(
  action: Action,
  flags: VerificationFlags | undefined,
): ActionTrustResult {
  if (flags) {
    const fatal = manifestFatalReasons(flags);
    if (fatal.length > 0) {
      return result(false, "MANIFEST_FATAL", "manifest-level fatal: no Action is trustworthy", {
        fatal,
      });
    }
  }
  if (action.status === "rejected") {
    return result(false, "ACTION_REJECTED", "Action was rejected during review");
  }
  if (!flags) {
    return result(
      false,
      "VERIFICATION_MISSING",
      "manifest carries no verification receipt; run verifyManifest before consuming",
    );
  }

  const perAction = (flags.actions ?? []).find((r) => r.action_id === action.id);
  if (!perAction) {
    if (!aggregateClean(flags)) {
      return result(
        false,
        "PER_ACTION_RESULT_MISSING",
        "receipt has no per-Action results and the aggregate verification is not clean; cannot attribute trust to this Action",
      );
    }
    return isVerifiedTierStatus(action.status)
      ? result(true, "READY", "aggregate verification passed (v0.1 receipt)")
      : result(
          false,
          "STATUS_NOT_VERIFIED_TIER",
          `aggregate verification passed but status is "${action.status}", not a verified-tier status`,
        );
  }

  if (!perAction.passed) {
    const errors = perAction.issues.filter((i) => (i.severity ?? "error") === "error");
    return result(false, "VERIFICATION_FAILED", "per-Action verification failed", {
      issues: errors,
    });
  }
  if (!isVerifiedTierStatus(action.status)) {
    return result(
      false,
      "STATUS_NOT_VERIFIED_TIER",
      `per-Action verification passed but status is "${action.status}", not a verified-tier status`,
    );
  }
  const warnings = perAction.issues.filter((i) => i.severity === "warning");
  return result(true, "READY", "per-Action verification passed", {
    ...(warnings.length ? { issues: warnings } : {}),
  });
}
