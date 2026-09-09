import {
  ExportError,
  evaluateActionTrust,
  manifestFatalReasons,
  type Action,
  type ActionManifest,
  type ActionTrustResult,
} from "@actionmanifest/core";

/**
 * Export safety policy (Phase 2, hardened).
 *
 * Export is consumption: exporters emit artifacts that downstream calendars
 * and apps act on, so the default policy exports only **trust-qualified**
 * Actions — exactly the Actions the reference consumer classifies as
 * `ready`. Status alone is never sufficient:
 *
 * - Default `include: "verified-only"` evaluates the shared trust policy
 *   (`evaluateActionTrust` from core): per-Action verification passed, no
 *   manifest-level fatal, and a verified-tier lifecycle status.
 * - `include: "all"` is the explicit audit opt-in. ICS entries always carry
 *   `X-ACTIONMANIFEST-STATUS` and `X-ACTIONMANIFEST-DISPOSITION` so a
 *   `status=verified` Action whose receipt failed can never be mistaken for
 *   a trustworthy one.
 * - A manifest-level fatal receipt (source hash mismatch / empty source)
 *   blocks export entirely with {@link ExportError}: the document is
 *   untrustworthy, so no executable output may be produced from it.
 */
export type ExportInclude = "verified-only" | "all";

export interface ExportPolicyOptions {
  /** Which Actions may be exported. Default: `"verified-only"`. */
  include?: ExportInclude;
}

export interface TrustedAction {
  action: Action;
  trust: ActionTrustResult;
}

/** Evaluate the shared trust policy for every Action in the manifest. */
export function evaluateExportTrust(manifest: ActionManifest): TrustedAction[] {
  const flags = manifest.receipt?.verification;
  return manifest.actions.map((action) => ({
    action,
    trust: evaluateActionTrust(action, flags),
  }));
}

/** Throw ExportError when the receipt proves a manifest-level fatal condition. */
export function assertExportable(manifest: ActionManifest): void {
  const flags = manifest.receipt?.verification;
  if (!flags) return;
  const fatal = manifestFatalReasons(flags);
  if (fatal.length > 0) {
    throw new ExportError(
      `Refusing to export: ${fatal.map((f) => f.message).join("; ")}`,
      { fatal },
    );
  }
}

/**
 * Select the Actions to export. Default (`verified-only`) returns only
 * trust-qualified Actions (consumer disposition `ready`); `include: "all"`
 * returns everything for audit purposes.
 */
export function selectExportableActions(
  manifest: ActionManifest,
  options: ExportPolicyOptions = {},
): Action[] {
  const include = options.include ?? "verified-only";
  if (include === "all") return manifest.actions;
  return evaluateExportTrust(manifest)
    .filter((t) => t.trust.ready)
    .map((t) => t.action);
}
