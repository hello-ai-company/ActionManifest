import type { ActionManifest } from "@actionmanifest/core";
import {
  assertExportable,
  selectExportableActions,
  type ExportPolicyOptions,
} from "./policy.js";

export interface JsonExportOptions extends ExportPolicyOptions {
  /** Pretty-print with 2-space indent. Default true. */
  pretty?: boolean;
}

/**
 * Serialize a manifest to JSON.
 *
 * Safety contract (Phase 2): the default policy is verified-only — unverified
 * Actions are omitted from the exported record. The verification receipt is
 * always preserved, so the exported file still shows WHY Actions are missing
 * (per-Action results and issues). Pass `include: "all"` for the full-fidelity
 * audit record. A manifest-level fatal receipt throws ExportError.
 *
 * The legacy `exportJson(manifest, pretty: boolean)` signature is accepted.
 */
export function exportJson(
  manifest: ActionManifest,
  options: boolean | JsonExportOptions = {},
): string {
  const opts: JsonExportOptions = typeof options === "boolean" ? { pretty: options } : options;
  assertExportable(manifest);
  const include = opts.include ?? "verified-only";
  const out: ActionManifest =
    include === "all"
      ? manifest
      : { ...manifest, actions: selectExportableActions(manifest, { include }) };
  return JSON.stringify(out, null, opts.pretty === false ? 0 : 2) + "\n";
}
