import {
  canonicalText,
  sourceContainsQuote,
  validateActionManifest,
  type Action,
  type ActionManifest,
  type ActionVerificationResult,
  type CanonicalDocument,
  type Temporal,
  type VerificationFlags,
  type VerificationIssue,
} from "@actionmanifest/core";
import {
  extractYearContext,
  isApproximateCue,
  isNegation,
  parseTemporals,
} from "@actionmanifest/temporal";

export interface VerifyOptions {
  now?: Date;
}

function issue(
  code: string,
  message: string,
  action_id?: string,
  severity: "error" | "warning" = "error",
): VerificationIssue {
  return { code, message, ...(action_id ? { action_id } : {}), severity };
}

function flattenTemporals(t?: Temporal): Temporal[] {
  if (!t) return [];
  return [t, ...(t.alternatives ?? []).flatMap(flattenTemporals)];
}

function evidenceCorpus(action: Action): string {
  return action.evidence.map((e) => e.text).join("\n");
}

function dateSupportedByEvidence(action: Action, source: string): boolean {
  const temporals = flattenTemporals(action.temporal);
  const exactDates = temporals.filter((t) => t.date && (t.type === "exact" || t.type === "conditional"));
  if (exactDates.length === 0) {
    // Approximate must not invent a date.
    for (const t of temporals) {
      if (t.type === "approximate" && t.date) return false;
    }
    return true;
  }

  const ctx = extractYearContext(source);
  const parsed = [
    ...parseTemporals(evidenceCorpus(action), ctx),
    ...parseTemporals(source, ctx),
  ];
  const allowed = new Set(parsed.filter((p) => p.date).map((p) => p.date));

  for (const t of exactDates) {
    if (!t.date) continue;
    if (allowed.has(t.date)) continue;
    // Hallucination: exact date from approximate cue only
    if (isApproximateCue(evidenceCorpus(action)) && !/\d{1,2}日/.test(evidenceCorpus(action))) {
      return false;
    }
    return false;
  }

  for (const t of temporals) {
    if (t.type === "approximate" && t.date) return false;
  }
  return true;
}

/**
 * Actor verification (Phase 1.1 hardening).
 * - unknown: never invent an actor; always supported.
 * - implicit: actor.text optional; not forced to appear verbatim in evidence.
 * - explicit: actor.text is REQUIRED and MUST appear in the Action's evidence.
 */
function actorCheck(action: Action): { ok: boolean; issue?: VerificationIssue } {
  const certainty = action.actor.certainty;
  if (certainty === "unknown" || certainty === "implicit") return { ok: true };

  const text = action.actor.text?.trim();
  if (!text) {
    return {
      ok: false,
      issue: issue(
        "ACTOR_TEXT_MISSING",
        "actor.certainty=explicit requires a non-empty actor.text",
        action.id,
      ),
    };
  }
  const corpus = evidenceCorpus(action);
  if (sourceContainsQuote(corpus, text) || corpus.includes(text)) return { ok: true };
  return {
    ok: false,
    issue: issue(
      "ACTOR_UNSUPPORTED",
      "explicit actor.text is not found in this Action's evidence",
      action.id,
    ),
  };
}

function modalitySupported(action: Action): boolean {
  const corpus = evidenceCorpus(action);
  if (action.modality === "unknown") return true;
  if (action.modality === "prohibited") {
    return isNegation(corpus) || /提出不要|禁止/.test(corpus);
  }
  if (action.modality === "required") {
    // Blanket required + negation without exemption conditions is a conflict (handled separately).
    return true;
  }
  if (action.modality === "optional") {
    return /希望者のみ|任意|optional|those who wish/i.test(corpus);
  }
  return true;
}

function negationConflict(action: Action): boolean {
  const corpus = evidenceCorpus(action);
  const hasNeg = isNegation(corpus) || /提出不要/.test(corpus);
  if (!hasNeg) return false;
  if (action.modality === "prohibited") return false;
  const conditions = (action.conditions ?? []).join(" ");
  if (/不要|再提出|already submitted|exemption|希望者/i.test(conditions)) return false;
  if (action.kind === "submit" && action.modality === "required" && conditions.length === 0) {
    return true;
  }
  return false;
}

function pageValid(action: Action, doc: CanonicalDocument): boolean {
  const pageNumbers = new Set((doc.pages ?? []).map((p) => p.pageNumber));
  for (const ev of action.evidence) {
    if (ev.page == null) continue;
    if (doc.pages && doc.pages.length > 0 && !pageNumbers.has(ev.page)) return false;
  }
  return true;
}

function evidenceCheck(
  action: Action,
  source: string,
  manifest: ActionManifest,
  doc: CanonicalDocument,
): { supported: boolean; issues: VerificationIssue[] } {
  const issues: VerificationIssue[] = [];
  if (!action.evidence?.length) {
    issues.push(issue("MISSING_EVIDENCE", "Action has no evidence", action.id));
    return { supported: false, issues };
  }
  let supported = true;
  for (const ev of action.evidence) {
    if (!sourceContainsQuote(source, ev.text)) {
      supported = false;
      issues.push(
        issue("EVIDENCE_NOT_IN_SOURCE", "Evidence quote was not found in the source document", action.id),
      );
    }
    // Source before inference: the quote must also BELONG to the current
    // canonical source. A wrong source_id is a per-Action provenance failure,
    // not a warning — even if the quote happens to appear in the text.
    if (ev.source_id && ev.source_id !== manifest.source.id && ev.source_id !== doc.id) {
      supported = false;
      issues.push(
        issue(
          "EVIDENCE_SOURCE_ID",
          `Evidence source_id "${ev.source_id}" does not belong to the current canonical source (manifest "${manifest.source.id}" / document "${doc.id}")`,
          action.id,
        ),
      );
    }
  }
  return { supported, issues };
}

/**
 * Verify a single Action independently. The result depends ONLY on this
 * Action's own Evidence/Temporal/Actor/Modality/Negation and page refs.
 * It never reads other Actions and never folds in the manifest-level fatal
 * (source hash / empty document) condition — those are applied at promotion time.
 */
export function verifyAction(
  action: Action,
  doc: CanonicalDocument,
  source: string,
  manifest: ActionManifest,
): ActionVerificationResult {
  const issues: VerificationIssue[] = [];

  const ev = evidenceCheck(action, source, manifest, doc);
  issues.push(...ev.issues);
  const evidence_supported = ev.supported;

  const temporal_supported = dateSupportedByEvidence(action, source);
  if (!temporal_supported) {
    issues.push(
      issue(
        "TEMPORAL_UNSUPPORTED",
        "Declared calendar date is not supported by evidence (possible hallucination)",
        action.id,
      ),
    );
  }

  const actor = actorCheck(action);
  const actor_supported = actor.ok;
  if (actor.issue) issues.push(actor.issue);

  const modality_supported = modalitySupported(action);
  if (!modality_supported) {
    issues.push(issue("MODALITY_UNSUPPORTED", "Modality is not supported by evidence", action.id));
  }

  const negation_conflict = negationConflict(action);
  if (negation_conflict) {
    issues.push(
      issue(
        "NEGATION_CONFLICT",
        "Required action conflicts with negation in evidence and has no exemption condition",
        action.id,
      ),
    );
  }

  const page_refs_valid = pageValid(action, doc);
  if (!page_refs_valid) {
    issues.push(issue("INVALID_PAGE_REF", "Evidence page is not in the canonical document", action.id));
  }

  const passed =
    evidence_supported &&
    temporal_supported &&
    actor_supported &&
    modality_supported &&
    !negation_conflict &&
    page_refs_valid;

  return {
    action_id: action.id,
    passed,
    evidence_supported,
    temporal_supported,
    actor_supported,
    modality_supported,
    negation_conflict,
    page_refs_valid,
    issues,
  };
}

export function verifyManifest(
  manifestInput: unknown,
  doc: CanonicalDocument,
  _options: VerifyOptions = {},
): { manifest: ActionManifest; flags: VerificationFlags } {
  const manifest = validateActionManifest(manifestInput);
  const source = canonicalText(doc);
  const manifestIssues: VerificationIssue[] = [];

  // --- Manifest-level (cross-cutting, fatal) checks ---
  const sourceEmpty = source.length === 0;
  if (sourceEmpty) {
    manifestIssues.push(issue("EMPTY_SOURCE", "Canonical document has no text"));
  }

  const sourceHashMatched =
    !manifest.source.hash || !doc.sourceHash || manifest.source.hash === doc.sourceHash;
  if (!sourceHashMatched) {
    manifestIssues.push(
      issue(
        "SOURCE_HASH_MISMATCH",
        `Manifest hash ${manifest.source.hash} != document hash ${doc.sourceHash}`,
      ),
    );
  }

  if (manifest.actions.length === 0) {
    manifestIssues.push(issue("NO_ACTIONS", "Manifest contains no actions", undefined, "warning"));
  }

  // A fatal failure means the document/manifest itself cannot be trusted, so no
  // Action may be promoted to verified even if its per-action checks pass.
  const fatal = sourceEmpty || !sourceHashMatched;

  // --- Per-action (independent) checks ---
  const actionResults = manifest.actions.map((a) => verifyAction(a, doc, source, manifest));

  // --- Backward-compatible aggregate summary (v0.1 semantics: AND across actions) ---
  let evidence_supported = actionResults.every((r) => r.evidence_supported);
  if (sourceEmpty) evidence_supported = false;
  const temporal_supported = actionResults.every((r) => r.temporal_supported);
  const actor_supported = actionResults.every((r) => r.actor_supported);
  const modality_supported = actionResults.every((r) => r.modality_supported);
  const negation_conflict = actionResults.some((r) => r.negation_conflict);
  const page_refs_valid = actionResults.every((r) => r.page_refs_valid);

  const allIssues = [...manifestIssues, ...actionResults.flatMap((r) => r.issues)];

  const total_actions = actionResults.length;
  const verified_actions = fatal ? 0 : actionResults.filter((r) => r.passed).length;
  const failed_actions = total_actions - verified_actions;
  const warning_actions = fatal
    ? 0
    : actionResults.filter((r) => r.passed && r.issues.some((i) => i.severity === "warning")).length;
  const passed = !fatal && actionResults.every((r) => r.passed);

  const flags: VerificationFlags = {
    evidence_supported,
    temporal_supported,
    actor_supported,
    modality_supported,
    source_hash_matched: sourceHashMatched,
    negation_conflict,
    page_refs_valid,
    checked_at: new Date().toISOString(),
    issues: allIssues,
    passed,
    total_actions,
    verified_actions,
    failed_actions,
    warning_actions,
    actions: actionResults,
  };

  const next: ActionManifest = {
    ...manifest,
    actions: manifest.actions.map((a, i) => {
      // Promote each Action independently: verified only when its own checks
      // pass AND there is no manifest-level fatal failure.
      const promote = !fatal && (actionResults[i]?.passed ?? false);
      return {
        ...a,
        status: promote && a.status === "proposed" ? "verified" : a.status,
      };
    }),
    receipt: {
      extraction: manifest.receipt?.extraction ?? {
        provider: "unknown",
        model: "unknown",
        extractor_version: "0.1.0",
        schema_version: String(manifest.schema_version),
        created_at: new Date().toISOString(),
      },
      verification: flags,
    },
  };

  return { manifest: next, flags };
}

/** True when the manifest as a whole verified (no fatal failure and every Action passed). */
export function verificationPassed(flags: VerificationFlags): boolean {
  if (typeof flags.passed === "boolean") return flags.passed;
  return (
    flags.evidence_supported &&
    flags.temporal_supported &&
    flags.actor_supported &&
    flags.modality_supported &&
    flags.source_hash_matched &&
    !flags.negation_conflict &&
    flags.page_refs_valid &&
    !(flags.issues ?? []).some((i) => i.severity === "error")
  );
}

/** True when a single Action's own verification passed (independent of the manifest). */
export function actionVerificationPassed(result: ActionVerificationResult): boolean {
  return result.passed;
}
