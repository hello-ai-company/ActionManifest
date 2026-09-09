import {
  evaluateActionTrust,
  manifestFatalReasons,
  trustDispositionFor,
  VERIFIED_TIER_STATUSES,
} from "@actionmanifest/core";
import type {
  Action,
  ActionManifest,
  ActionVerificationResult,
  TrustDisposition,
  VerificationFlags,
} from "@actionmanifest/core";

/**
 * Reference consumer policy (Phase 2).
 *
 * Third-party applications MUST NOT treat `status === "verified"` alone as
 * sufficient: an Action is consumable only when the shared trust policy
 * (`evaluateActionTrust` in core — the same predicate the exporters use)
 * says it is ready. This module is the reference implementation of the
 * consumer view over that policy. It classifies; it never executes.
 *
 * Dispositions:
 * - `ready` — per-Action verification passed, no manifest-level fatal, and
 *   the Action's status is in the verified lifecycle tier (verified/
 *   accepted/exported). Safe to consume.
 * - `review_required` — trust cannot be established from the receipt alone
 *   (verification missing, v0.1 aggregate-only receipt with failures, or a
 *   passed-but-not-promoted oddity). A human must review before use.
 * - `blocked` — verification failed for this Action, a human rejected it, or
 *   a manifest-level fatal poisons the whole document. Do not use.
 */
export type ActionDisposition = TrustDisposition;

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
export const CONSUMABLE_STATUSES = VERIFIED_TIER_STATUSES;

function classifyOne(
  action: Action,
  flags: VerificationFlags | undefined,
): ConsumableAction {
  const trust = evaluateActionTrust(action, flags);
  const verification = (flags?.actions ?? []).find((r) => r.action_id === action.id);
  const reasons: DispositionReason[] =
    trust.reason === "VERIFICATION_FAILED" || trust.reason === "READY"
      ? (trust.issues ?? []).map((i) => ({ code: i.code, message: i.message }))
      : trust.reason === "MANIFEST_FATAL"
        ? (trust.fatal ?? []).map((f) => ({ code: f.code, message: f.message }))
        : [{ code: trust.reason, message: trust.message }];
  return {
    action,
    disposition: trustDispositionFor(trust.reason),
    reasons,
    ...(verification ? { verification } : {}),
  };
}

/**
 * Classify every Action of a verified (or unverified) manifest for safe
 * consumption. Pure function of the manifest + its receipt; no I/O.
 */
export function classifyManifest(manifest: ActionManifest): ConsumerReport {
  const flags = manifest.receipt?.verification;
  const fatal = flags ? manifestFatalReasons(flags) : [];
  const actions = manifest.actions.map((a) => classifyOne(a, flags));
  const counts: Record<ActionDisposition, number> = { ready: 0, review_required: 0, blocked: 0 };
  for (const a of actions) counts[a.disposition] += 1;
  return {
    manifestFatal: fatal.length > 0,
    fatalReasons: fatal.map((f) => ({ code: f.code, message: f.message })),
    actions,
    counts,
  };
}

/** Convenience: the Actions safe to consume right now. */
export function readyActions(manifest: ActionManifest): Action[] {
  return classifyManifest(manifest)
    .actions.filter((a) => a.disposition === "ready")
    .map((a) => a.action);
}
