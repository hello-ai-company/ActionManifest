import {
  ActionManifestError,
  createSourceQuoteMatcher,
  sha256Hex,
  validateActionManifest,
  type ActionManifest,
  type VerificationIssue,
} from "@actionmanifest/core";
import { isDeepStrictEqual } from "node:util";
import { assertInputBudget, MATOE_INPUT_LIMITS, swiftDateTime } from "./matoe.js";

const checks = ["evidence_supported", "temporal_supported", "actor_supported", "modality_supported", "page_refs_valid"] as const;
const errorIssue = (issue: VerificationIssue) => issue.severity !== "warning";
const malformedUnicode = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
function refuse(message: string): never {
  throw new ActionManifestError("MATOE_V02_CONTRACT_BLOCKED", message);
}

/**
 * Full-fidelity wire for the NEW Matoe v0.2 bridge. Never feed it to the old
 * v0.1 bridge. Preserves all fields and failed Actions; no downgrade or execution.
 * Receipt integrity is checked, but issuer authenticity is not established.
 */
export function prepareMatoeV02Manifest(input: unknown, canonicalSourceText: string, expectedSourceId: string): ActionManifest {
  if (typeof canonicalSourceText !== "string" || typeof expectedSourceId !== "string") refuse("Canonical source text and identity are required");
  try { assertInputBudget(input); } catch { refuse("Manifest exceeds the Matoe input budget"); }
  if (!canonicalSourceText.trim() || malformedUnicode(canonicalSourceText) || malformedUnicode(expectedSourceId)
    || Buffer.byteLength(canonicalSourceText, "utf8") > MATOE_INPUT_LIMITS.ocrBytes
    || Array.from(canonicalSourceText).length > MATOE_INPUT_LIMITS.ocrScalars) {
    refuse("Canonical OCR is empty or exceeds the Matoe input budget");
  }
  let manifest: ActionManifest;
  try { manifest = structuredClone(validateActionManifest(input)); }
  catch { refuse("Manifest does not satisfy a frozen schema"); }
  const values: unknown[] = [manifest];
  while (values.length) {
    const value = values.pop();
    if (typeof value === "string" && malformedUnicode(value)) refuse("Manifest contains malformed Unicode");
    else if (value && typeof value === "object") values.push(...Object.values(value));
  }
  if (manifest.schema_version !== "0.2.0") refuse("The explicit v0.2 route requires schema 0.2.0");
  if (!expectedSourceId.trim() || manifest.source.id !== expectedSourceId) refuse("Source identity does not match the request");
  if (manifest.source.hash !== sha256Hex(canonicalSourceText)) refuse("Source hash does not match the exact canonical OCR");
  const extraction = manifest.receipt?.extraction;
  if (!extraction || extraction.schema_version !== manifest.schema_version
    || !swiftDateTime(extraction.created_at)
    || [extraction.provider, extraction.model, extraction.extractor_version].some(value => !value.trim() || value.trim().toLowerCase() === "unknown")) {
    refuse("Complete matching extraction provenance is required");
  }
  const ids = new Set(manifest.actions.map(action => action.id));
  if (ids.size !== manifest.actions.length) refuse("Action identities must be unique");
  const matchesSource = createSourceQuoteMatcher(canonicalSourceText);
  for (const action of manifest.actions) {
    if (!action.id.trim() || !action.title.trim() || !["proposed", "verified"].includes(action.status)) {
      refuse("Action identity or ingress lifecycle state is invalid");
    }
    if (action.evidence.some(evidence => evidence.source_id !== expectedSourceId || !matchesSource(evidence.text))) {
      refuse("Evidence does not resolve to the request source");
    }
  }
  const flags = manifest.receipt?.verification;
  if (!flags || !flags.source_hash_matched || !flags.checked_at || !swiftDateTime(flags.checked_at)
    || !flags.actions || !flags.issues || flags.issues.some(issue => issue.code === "EMPTY_SOURCE" || issue.code === "SOURCE_HASH_MISMATCH")) {
    refuse("Complete nonfatal v0.2 verification is required");
  }
  const results = flags.actions;
  if (results.length !== ids.size || new Set(results.map(result => result.action_id)).size !== ids.size
    || results.some(result => !ids.has(result.action_id))) {
    refuse("Per-action results must be complete and unique");
  }
  const validateIssue = (issue: VerificationIssue) => {
    if (!issue.code.trim() || !issue.message.trim() || (issue.action_id !== undefined && !ids.has(issue.action_id))) {
      refuse("Verification issue identity is invalid");
    }
  };
  flags.issues.forEach(validateIssue);
  for (const result of results) {
    result.issues.forEach(validateIssue);
    if (result.issues.some(issue => issue.action_id !== result.action_id)) refuse("Per-action issues must identify their Action");
    const hasError = result.issues.some(errorIssue);
    const intrinsicPass = checks.every(key => result[key]) && !result.negation_conflict;
    if (result.passed !== (intrinsicPass && !hasError) || (!result.passed && !hasError)) {
      refuse("Per-action verdict is inconsistent or lacks a failure reason");
    }
    if (manifest.actions.find(action => action.id === result.action_id)?.status === "verified" && !result.passed) {
      refuse("Failed verification cannot carry verified status");
    }
    for (const issue of result.issues) {
      if (!flags.issues.some(aggregate => isDeepStrictEqual(issue, aggregate))) refuse("Per-action issue is missing from the aggregate");
    }
  }
  for (const issue of flags.issues) {
    if (issue.action_id !== undefined && !results.find(result => result.action_id === issue.action_id)?.issues.some(item => isDeepStrictEqual(item, issue))) {
      refuse("Aggregate action issue is missing from its per-action result");
    }
    if (issue.action_id === undefined && errorIssue(issue)) refuse("An unattributed error cannot establish per-action trust");
  }
  const verified = results.filter(result => result.passed).length;
  const warnings = results.filter(result => result.passed && result.issues.some(issue => issue.severity === "warning")).length;
  if (flags.passed !== results.every(result => result.passed)
    || flags.total_actions !== ids.size || flags.verified_actions !== verified
    || flags.failed_actions !== ids.size - verified || flags.warning_actions !== warnings
    || checks.some(key => flags[key] !== results.every(result => result[key]))
    || flags.negation_conflict !== results.some(result => result.negation_conflict)) {
    refuse("Aggregate verification is inconsistent with the per-action results");
  }
  return manifest;
}
