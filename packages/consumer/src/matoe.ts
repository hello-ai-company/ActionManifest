import {
  ActionManifestError,
  createSourceQuoteMatcher,
  sha256Hex,
  sourceContainsQuote,
  validateActionManifest,
  type ActionManifest,
  type VerificationFlags,
} from "@actionmanifest/core";
import { isDeepStrictEqual } from "node:util";

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

export const MATOE_INPUT_LIMITS = Object.freeze({
  manifestBytes: 1_048_576,
  ocrBytes: 240_000,
  ocrScalars: 60_000,
  nestingDepth: 24,
});

export function assertInputBudget(input: unknown): void {
  let remaining = MATOE_INPUT_LIMITS.manifestBytes;
  const stack = [{ value: input, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (depth > MATOE_INPUT_LIMITS.nestingDepth || stack.length > 10_000) refuse("Manifest nesting/collection limit exceeded");
    if (typeof value === "string") remaining -= Buffer.byteLength(value, "utf8") + 2;
    else if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length > 10_000) refuse("Manifest collection limit exceeded");
      for (const [key, child] of entries) {
        remaining -= Buffer.byteLength(key, "utf8") + 4;
        if (remaining < 0) refuse("Manifest size limit exceeded");
        stack.push({ value: child, depth: depth + 1 });
      }
    } else remaining -= 16;
    if (remaining < 0) refuse("Manifest size limit exceeded");
  }
}

// AJV accepts lowercase separators and leap seconds; the actual Swift parser
// requires uppercase T/Z and seconds 00..59. Never emit a receipt it rejects.
export function swiftDateTime(value: string): boolean {
  return !value.startsWith("0000") && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value);
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
  const malformedUnicode = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
  if (typeof canonicalSourceText !== "string" || malformedUnicode(canonicalSourceText)) {
    refuse("Canonical OCR must contain well-formed Unicode");
  }
  if (Buffer.byteLength(canonicalSourceText, "utf8") > MATOE_INPUT_LIMITS.ocrBytes
    || Array.from(canonicalSourceText).length > MATOE_INPUT_LIMITS.ocrScalars) refuse("Canonical OCR size limit exceeded");
  assertInputBudget(input);
  // Validate before copying: unknown versions/keys and explicit nulls fail closed.
  const originalManifest = structuredClone(validateActionManifest(input));
  const values: unknown[] = [originalManifest];
  while (values.length) {
    const value = values.pop();
    if (typeof value === "string" && malformedUnicode(value)) refuse("Manifest must contain well-formed Unicode");
    else if (value && typeof value === "object") values.push(...Object.values(value));
  }
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
  if (!swiftDateTime(extraction.created_at)) refuse("Extraction timestamp is outside Swift's strict date-time contract");
  const ids = new Set(manifest.actions.map(action => action.id));
  if (ids.size !== manifest.actions.length) refuse("Duplicate action IDs");
  const matchesSource = createSourceQuoteMatcher(canonicalSourceText);
  for (const action of manifest.actions) {
    if (!["proposed", "verified"].includes(action.status)) {
      refuse("Action status cannot enter Matoe; approval/lifecycle states are never reset");
    }
    if (!action.id.trim() || !action.title.trim()) refuse("Blank action identity/title");
    if ((action.conditions?.length ?? 0) > 0 || action.notes !== undefined) {
      refuse("Action conditions/notes are not displayed or used for review by the current Swift bridge");
    }
    const visibleEvidence = action.evidence[0];
    if (!visibleEvidence || action.evidence.some(evidence => !isDeepStrictEqual(evidence, visibleEvidence))) {
      refuse("Swift displays only the first Evidence quote; distinct quotes/locators require another profile");
    }
    for (const evidence of action.evidence) {
      if (evidence.source_id !== manifest.source.id || !matchesSource(evidence.text)) {
        refuse("Action evidence does not resolve to the canonical source");
      }
    }
    if (action.actor.role !== undefined || (action.actor.text !== undefined
      && !sourceContainsQuote(visibleEvidence.text, action.actor.text))) {
      refuse("Swift does not display actor identity; actor text must remain in its visible Evidence quote and role is unsupported");
    }
    // Keep the initial compatibility profile deliberately small. Rich temporal
    // forms need a separate profile plus Swift mapping tests, never coercion.
    if (action.temporal) {
      const temporal = action.temporal;
      if (temporal.timezone !== undefined) refuse("Explicit timezone is ignored by Swift's device-local date mapping");
      if (temporal.type !== "exact" || temporal.precision !== "day" || !temporal.date
        || !temporal.raw_text.trim()
        || Object.keys(temporal).some(key => ![
          "type", "precision", "date", "raw_text", "certainty",
          "year", "month", "day", "end", "deadline_qualifier",
        ].includes(key))
        || (temporal.end !== undefined && temporal.end !== temporal.date)
        || (temporal.deadline_qualifier !== undefined && !["until", "on_day"].includes(temporal.deadline_qualifier))) {
        refuse("Action temporal form is outside the exact-day Matoe compatibility profile");
      }
      const [year, month, day] = temporal.date.split("-").map(Number);
      if (year === 0 || (temporal.year !== undefined && temporal.year !== year)
        || (temporal.month !== undefined && temporal.month !== month)
        || (temporal.day !== undefined && temporal.day !== day)) {
        refuse("Action temporal components contradict the exact date");
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
    if (flags.checked_at !== undefined && !swiftDateTime(flags.checked_at)) refuse("Verification timestamp is outside Swift's strict date-time contract");
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
    if (issues.length) {
      refuse("Verification issues/warnings are not displayed by the current Swift bridge; projection would hide their message");
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
