import type { ActionManifest } from "@actionmanifest/core";

export function formatSummary(manifest: ActionManifest): string {
  const lines: string[] = [];
  lines.push(`Source: ${manifest.source.id}${manifest.source.hash ? ` (sha256 ${manifest.source.hash.slice(0, 12)}…)` : ""}`);
  lines.push(`Schema: ${manifest.schema_version}`);
  if (manifest.receipt?.extraction) {
    const e = manifest.receipt.extraction;
    lines.push(`Extracted by ${e.provider}/${e.model} at ${e.created_at}`);
  }
  if (manifest.receipt?.verification) {
    const v = manifest.receipt.verification;
    const ok =
      v.evidence_supported &&
      v.temporal_supported &&
      v.actor_supported &&
      v.modality_supported &&
      v.source_hash_matched &&
      !v.negation_conflict &&
      v.page_refs_valid;
    lines.push(`Verification: ${ok ? "PASS" : "FAIL"}`);
    for (const issue of v.issues ?? []) {
      lines.push(`  - [${issue.severity ?? "error"}] ${issue.code}: ${issue.message}${issue.action_id ? ` (${issue.action_id})` : ""}`);
    }
  }
  lines.push("");
  lines.push(`Actions (${manifest.actions.length})`);
  lines.push("");

  manifest.actions.forEach((action, i) => {
    lines.push(`${i + 1}. [${action.kind}] ${action.title}`);
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
    for (const ev of action.evidence) {
      const quote = ev.text.length > 160 ? `${ev.text.slice(0, 157)}…` : ev.text;
      lines.push(`   Evidence: 「${quote}」`);
    }
    lines.push("");
  });

  return lines.join("\n");
}
