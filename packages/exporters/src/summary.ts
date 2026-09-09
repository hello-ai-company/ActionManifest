import type {
  ActionManifest,
  ActionVerificationResult,
  VerificationFlags,
} from "@actionmanifest/core";

/** PASS when everything verified, PARTIAL when some actions verified, else FAIL. */
export function verificationVerdict(v: VerificationFlags): "PASS" | "PARTIAL" | "FAIL" {
  if (v.passed) return "PASS";
  const verified = v.verified_actions ?? 0;
  const total = v.total_actions ?? 0;
  if (verified > 0 && verified < total) return "PARTIAL";
  return "FAIL";
}

function resultsById(v: VerificationFlags): Map<string, ActionVerificationResult> {
  const map = new Map<string, ActionVerificationResult>();
  for (const r of v.actions ?? []) map.set(r.action_id, r);
  return map;
}

function failureReasons(result: ActionVerificationResult | undefined): string[] {
  if (!result) return [];
  return result.issues
    .filter((i) => (i.severity ?? "error") === "error")
    .map((i) => `${i.code}: ${i.message}`);
}

export function formatSummary(manifest: ActionManifest): string {
  const lines: string[] = [];
  lines.push(`Source: ${manifest.source.id}${manifest.source.hash ? ` (sha256 ${manifest.source.hash.slice(0, 12)}…)` : ""}`);
  lines.push(`Schema: ${manifest.schema_version}`);
  if (manifest.receipt?.extraction) {
    const e = manifest.receipt.extraction;
    lines.push(`Extracted by ${e.provider}/${e.model} at ${e.created_at}`);
  }
  const v = manifest.receipt?.verification;
  const byId = v ? resultsById(v) : new Map<string, ActionVerificationResult>();
  if (v) {
    const verdict = verificationVerdict(v);
    const total = v.total_actions ?? manifest.actions.length;
    const verified = v.verified_actions ?? 0;
    const detail = verdict === "PASS" ? "" : ` (${verified}/${total} verified)`;
    lines.push(`Verification: ${verdict}${detail}`);
    if (!v.source_hash_matched) lines.push("  source_hash_matched: false (manifest-level fatal)");
    for (const issue of v.issues ?? []) {
      lines.push(`  - [${issue.severity ?? "error"}] ${issue.code}: ${issue.message}${issue.action_id ? ` (${issue.action_id})` : ""}`);
    }
  }
  lines.push("");
  lines.push(`Actions (${manifest.actions.length})`);
  lines.push("");

  manifest.actions.forEach((action, i) => {
    const result = byId.get(action.id);
    const mark =
      v == null
        ? ""
        : result?.passed && v.passed !== false
          ? " [VERIFIED]"
          : result?.passed && !v.source_hash_matched
            ? " [UNVERIFIED: source hash]"
            : result?.passed
              ? " [VERIFIED]"
              : " [UNVERIFIED]";
    lines.push(`${i + 1}. [${action.kind}] ${action.title}${mark}`);
    lines.push(`   Modality: ${action.modality} · Actor: ${action.actor.text ?? action.actor.role ?? action.actor.certainty}`);
    if (action.temporal) {
      const t = action.temporal;
      const when = t.date ? t.date : `${t.type} (${t.raw_text})`;
      const extra = [
        t.deadline_qualifier,
        t.condition,
        ...(t.alternatives ?? []).map((a) => `alt ${a.date ?? a.raw_text}${a.condition ? ` if ${a.condition}` : ""}`),
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(`   When: ${when}${extra ? ` · ${extra}` : ""}`);
    }
    if (action.conditions?.length) {
      lines.push(`   Conditions: ${action.conditions.join("; ")}`);
    }
    for (const reason of failureReasons(result)) {
      lines.push(`   Reason: ${reason}`);
    }
    for (const ev of action.evidence) {
      const quote = ev.text.length > 160 ? `${ev.text.slice(0, 157)}…` : ev.text;
      lines.push(`   Evidence: 「${quote}」`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * Compact per-Action verification report for `actionman validate`.
 * Shows mixed (PARTIAL) results so downstream can trust valid Actions while
 * only the offending Actions are held back.
 */
export function formatVerification(manifest: ActionManifest): string {
  const v = manifest.receipt?.verification;
  if (!v) return "Verification: (not run)";
  const byId = resultsById(v);
  const verdict = verificationVerdict(v);
  const total = v.total_actions ?? manifest.actions.length;
  const verified = v.verified_actions ?? 0;
  const failed = v.failed_actions ?? total - verified;

  const lines: string[] = [];
  lines.push(`Verification: ${verdict}`);
  lines.push(`${total} action${total === 1 ? "" : "s"} · ✓ ${verified} verified · ✗ ${failed} failed`);
  lines.push(`source_hash_matched: ${v.source_hash_matched}`);
  if (!v.source_hash_matched) {
    lines.push("(manifest-level fatal: no action can be verified while the source hash mismatches)");
  }
  lines.push("");

  manifest.actions.forEach((action) => {
    const result = byId.get(action.id);
    const promoted = result?.passed && v.source_hash_matched && !isEmptyDocFatal(v);
    lines.push(`${promoted ? "[VERIFIED]" : "[FAILED]  "} ${action.id}  ${action.title}`);
    if (!promoted) {
      for (const reason of failureReasons(result)) lines.push(`   Reason: ${reason}`);
      if (result?.passed && !v.source_hash_matched) {
        lines.push("   Reason: SOURCE_HASH_MISMATCH (manifest-level fatal)");
      }
    }
  });

  return lines.join("\n");
}

function isEmptyDocFatal(v: VerificationFlags): boolean {
  return (v.issues ?? []).some((i) => i.code === "EMPTY_SOURCE");
}
