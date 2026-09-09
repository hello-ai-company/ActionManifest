import {
  ExportError,
  manifestFatalReasons,
  type Action,
  type ActionManifest,
} from "@actionmanifest/core";

/**
 * Export safety policy (Phase 2).
 *
 * Exporters emit executable artifacts (ICS calendar entries) and transfer
 * records (JSON). Unverified Actions MUST NOT leak into either without an
 * explicit opt-in:
 *
 * - Default `include: "verified-only"` exports only Actions in the verified
 *   lifecycle tier (`verified` / `accepted` / `exported`).
 * - `include: "all"` is the explicit opt-in. In ICS, unverified entries are
 *   marked with `X-ACTIONMANIFEST-STATUS` so downstream calendar tooling can
 *   still tell them apart.
 * - A manifest-level fatal receipt (source hash mismatch / empty source)
 *   blocks export entirely with {@link ExportError}: the document is
 *   untrustworthy, so no executable output may be produced from it.
 */
export type ExportInclude = "verified-only" | "all";

export interface ExportPolicyOptions {
  /** Which Actions may be exported. Default: `"verified-only"`. */
  include?: ExportInclude;
}

/** Lifecycle statuses treated as verified for export. */
export const EXPORTABLE_STATUSES = ["verified", "accepted", "exported"] as const;

export function isExportableStatus(status: string): boolean {
  return (EXPORTABLE_STATUSES as readonly string[]).includes(status);
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

/** Filter the actions of a manifest according to the export policy. */
export function selectExportableActions(
  manifest: ActionManifest,
  options: ExportPolicyOptions = {},
): Action[] {
  const include = options.include ?? "verified-only";
  if (include === "all") return manifest.actions;
  return manifest.actions.filter((a) => isExportableStatus(a.status));
}
