import {
  ActionManifestError,
  sha256Hex,
  sourceContainsQuote,
  validateActionManifest,
  type ActionManifest,
  type VerificationFlags,
} from "@actionmanifest/core";

/** This bundle is an explicit compatibility projection, never an execution. */
export interface MatoeCompatibilityBundle {
  manifest: ActionManifest;
  audit: {
    profile: "matoe-v0.1-clean/1";
    originalManifest: ActionManifest;
    changes: string[];
    warnings: string[];
  };
}

function refuse(reason: string): never {
  throw new ActionManifestError("MATOE_COMPATIBILITY_BLOCKED", reason);
}

const checks = [
  "evidence_supported", "temporal_supported", "actor_supported",
  "modality_supported", "page_refs_valid",
] as const;
const additions = [
  "passed", "total_actions", "verified_actions", "failed_actions", "warning_actions", "actions",
] as const;

function clean(flags: Pick<VerificationFlags, typeof checks[number] | "negation_conflict" | "issues">): boolean {
  return checks.every(key => flags[key]) && !flags.negation_conflict
    && !(flags.issues ?? []).some(issue => issue.severity !== "warning");
}

/**
 * Project only a unanimous clean receipt (or proposed, unverified extraction).
 * Full original provenance and per-action results MUST be retained in audit.
 * canonicalSourceText is the exact OCR string sent by Matoe, without trimming.
 * Input/output schema validation is separate from this conservative ingress policy.
 */
export function prepareMatoeManifest(input: unknown, canonicalSourceText: string): MatoeCompatibilityBundle {
  // Validate before copying: unknown versions/keys and explicit nulls fail closed.
  const originalManifest = structuredClone(validateActionManifest(input));
  const manifest = structuredClone(originalManifest);
  const changes: string[] = [];
  const warnings: string[] = [];
  if (!canonicalSourceText.trim()) refuse("Canonical OCR text is empty");
  if (manifest.source.hash !== sha256Hex(canonicalSourceText)) {
    refuse("source.hash must equal SHA-256 of the exact canonical OCR text");
  }
  if (!manifest.source.id.trim()) refuse("source.id is blank");
  const extraction = manifest.receipt?.extraction;
  if (!extraction || extraction.schema_version !== manifest.schema_version) {
    refuse("Matching extraction provenance is required; schema_version must match the source manifest");
  }
  for (const key of ["provider", "model", "extractor_version"] as const) {
    if (!extraction[key].trim() || extraction[key].trim().toLowerCase() === "unknown") {
      refuse(`Unknown extraction provenance: ${key}`);
    }
  }
  const ids = new Set(manifest.actions.map(action => action.id));
  if (ids.size !== manifest.actions.length) refuse("Duplicate action IDs");
  for (const action of manifest.actions) {
    if (!["proposed", "verified"].includes(action.status)) {
      refuse(`Action ${action.id}: status ${action.status} cannot enter Matoe; approval/lifecycle states are never reset`);
    }
    if (!action.id.trim() || !action.title.trim()) refuse("Blank action identity/title");
    for (const evidence of action.evidence) {
      if (evidence.source_id !== manifest.source.id || !sourceContainsQuote(canonicalSourceText, evidence.text)) {
        refuse(`Action ${action.id}: evidence does not resolve to the canonical source`);
      }
    }
    // Keep the initial compatibility profile deliberately small. Rich temporal
    // forms need a separate profile plus Swift mapping tests, never coercion.
    if (action.temporal) {
      const temporal = action.temporal;
      if (temporal.type !== "exact" || temporal.precision !== "day" || !temporal.date
        || !temporal.raw_text.trim()
        || Object.keys(temporal).some(key => ![
          "type", "precision", "date", "raw_text", "certainty", "timezone",
          "year", "month", "day", "end", "deadline_qualifier",
        ].includes(key))
        || (temporal.end !== undefined && temporal.end !== temporal.date)
        || (temporal.deadline_qualifier !== undefined && !["until", "on_day"].includes(temporal.deadline_qualifier))) {
        refuse(`Action ${action.id}: temporal form is outside the exact-day Matoe compatibility profile`);
      }
      const [year, month, day] = temporal.date.split("-").map(Number);
      if ((temporal.year !== undefined && temporal.year !== year)
        || (temporal.month !== undefined && temporal.month !== month)
        || (temporal.day !== undefined && temporal.day !== day)) {
        refuse(`Action ${action.id}: temporal components contradict the exact date`);
      }
    }
  }
  const flags = manifest.receipt?.verification;
  if (!flags) {
    if (manifest.actions.some(action => action.status !== "proposed")) {
      refuse("Verified status without verification receipt");
    }
    warnings.push("Verification is missing: every action requires user review in Matoe.");
  } else {
    if (!flags.source_hash_matched || !clean(flags)) {
      refuse("Only unanimous clean verification can be represented by Matoe's aggregate receipt; failed/mixed results are refused");
    }
    const issues = [...(flags.issues ?? []), ...(flags.actions ?? []).flatMap(result => result.issues ?? [])];
    for (const issue of issues) {
      if (!issue.code.trim() || !issue.message.trim() || (issue.action_id !== undefined && !ids.has(issue.action_id))) {
        refuse("Verification issue has blank/unknown identity");
      }
    }
    if (manifest.schema_version === "0.2.0") {
      const results = flags.actions;
      if (!results || results.length !== ids.size || new Set(results.map(result => result.action_id)).size !== ids.size
        || results.some(result => !ids.has(result.action_id) || !result.passed || !clean(result))) {
        refuse("Complete unique clean per-action results are required for v0.2 verification");
      }
      const warningCount = results.filter(result => (result.issues ?? []).some(issue => issue.severity === "warning")).length;
      if (flags.passed !== true || flags.total_actions !== ids.size || flags.verified_actions !== ids.size
        || flags.failed_actions !== 0 || flags.warning_actions !== warningCount) {
        refuse("Verification summary is incomplete or inconsistent with per-action results");
      }
      for (const issue of results.flatMap(result => result.issues ?? [])) {
        if (!(flags.issues ?? []).some(aggregate => aggregate.code === issue.code
          && aggregate.message === issue.message && aggregate.action_id === issue.action_id
          && aggregate.severity === issue.severity)) {
          refuse("Per-action issue is absent from aggregate issues; projection would hide it");
        }
      }
      for (const key of additions) {
        delete flags[key];
        changes.push(`/receipt/verification/${key}: retained in audit.originalManifest`);
      }
    }
  }
  if (manifest.schema_version !== "0.1.0") {
    manifest.schema_version = "0.1.0";
    extraction.schema_version = "0.1.0";
    changes.push("/schema_version: 0.2.0 -> 0.1.0", "/receipt/extraction/schema_version: wire projection only; original provenance retained in audit.originalManifest");
  }
  validateActionManifest(manifest);
  return {
    manifest,
    audit: { profile: "matoe-v0.1-clean/1", originalManifest, changes, warnings },
  };
}
