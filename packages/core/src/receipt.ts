import type { VerificationFlags } from "@actionmanifest/schema";

export interface FatalReason {
  code: string;
  message: string;
}

/**
 * Manifest-level fatal detection from a verification receipt: the source hash
 * did not match, or the canonical document was empty. When fatal, NO Action
 * may be treated as executable — even ones whose per-Action checks passed
 * (the verifier blocks promotion for the same reason). Shared by the
 * reference consumer and the exporters so the rule lives exactly once.
 */
export function manifestFatalReasons(flags: VerificationFlags): FatalReason[] {
  const reasons: FatalReason[] = [];
  if (flags.source_hash_matched === false) {
    reasons.push({
      code: "SOURCE_HASH_MISMATCH",
      message: "manifest-level fatal: source hash does not match the document",
    });
  }
  for (const issue of flags.issues ?? []) {
    if (issue.code === "EMPTY_SOURCE") {
      reasons.push({
        code: "EMPTY_SOURCE",
        message: "manifest-level fatal: canonical document has no text",
      });
    }
  }
  return reasons;
}
