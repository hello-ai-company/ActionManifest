import {
  canonicalText,
  sourceContainsQuote,
  validateActionManifest,
  type Action,
  type ActionManifest,
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

function actorSupported(action: Action): boolean {
  const corpus = evidenceCorpus(action);
  if (action.actor.certainty === "unknown") return true;
  if (action.actor.certainty === "implicit") return true;
  if (!action.actor.text) return true;
  return sourceContainsQuote(corpus, action.actor.text) || corpus.includes(action.actor.text);
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

export function verifyManifest(
  manifestInput: unknown,
  doc: CanonicalDocument,
  _options: VerifyOptions = {},
): { manifest: ActionManifest; flags: VerificationFlags } {
  const manifest = validateActionManifest(manifestInput);
  const source = canonicalText(doc);
  const issues: VerificationIssue[] = [];

  let evidence_supported = true;
  let temporal_supported = true;
  let actor_supported = true;
  let modality_supported = true;
  let negation_conflict = false;
  let page_refs_valid = true;

  if (!source) {
    evidence_supported = false;
    issues.push(issue("EMPTY_SOURCE", "Canonical document has no text"));
  }

  const sourceHashMatched =
    !manifest.source.hash || !doc.sourceHash || manifest.source.hash === doc.sourceHash;
  if (!sourceHashMatched) {
    issues.push(
      issue(
        "SOURCE_HASH_MISMATCH",
        `Manifest hash ${manifest.source.hash} != document hash ${doc.sourceHash}`,
      ),
    );
  }

  if (manifest.actions.length === 0) {
    issues.push(issue("NO_ACTIONS", "Manifest contains no actions", undefined, "warning"));
  }

  for (const action of manifest.actions) {
    if (!action.evidence?.length) {
      evidence_supported = false;
      issues.push(issue("MISSING_EVIDENCE", "Action has no evidence", action.id));
      continue;
    }
    for (const ev of action.evidence) {
      if (!sourceContainsQuote(source, ev.text)) {
        evidence_supported = false;
        issues.push(
          issue(
            "EVIDENCE_NOT_IN_SOURCE",
            "Evidence quote was not found in the source document",
            action.id,
          ),
        );
      }
      if (ev.source_id && ev.source_id !== manifest.source.id && ev.source_id !== doc.id) {
        issues.push(
          issue(
            "EVIDENCE_SOURCE_ID",
            `Evidence source_id ${ev.source_id} does not match document`,
            action.id,
            "warning",
          ),
        );
      }
    }

    if (!dateSupportedByEvidence(action, source)) {
      temporal_supported = false;
      issues.push(
        issue(
          "TEMPORAL_UNSUPPORTED",
          "Declared calendar date is not supported by evidence (possible hallucination)",
          action.id,
        ),
      );
    }

    if (!actorSupported(action)) {
      actor_supported = false;
      issues.push(issue("ACTOR_UNSUPPORTED", "Actor text is not supported by evidence", action.id));
    }

    if (!modalitySupported(action)) {
      modality_supported = false;
      issues.push(
        issue("MODALITY_UNSUPPORTED", "Modality is not supported by evidence", action.id),
      );
    }

    if (negationConflict(action)) {
      negation_conflict = true;
      issues.push(
        issue(
          "NEGATION_CONFLICT",
          "Required action conflicts with negation in evidence and has no exemption condition",
          action.id,
        ),
      );
    }

    if (!pageValid(action, doc)) {
      page_refs_valid = false;
      issues.push(issue("INVALID_PAGE_REF", "Evidence page is not in the canonical document", action.id));
    }
  }

  const flags: VerificationFlags = {
    evidence_supported,
    temporal_supported,
    actor_supported,
    modality_supported,
    source_hash_matched: sourceHashMatched,
    negation_conflict,
    page_refs_valid,
    checked_at: new Date().toISOString(),
    issues,
  };

  const next: ActionManifest = {
    ...manifest,
    actions: manifest.actions.map((a) => ({
      ...a,
      status:
        evidence_supported &&
        temporal_supported &&
        actor_supported &&
        modality_supported &&
        sourceHashMatched &&
        !negation_conflict &&
        page_refs_valid
          ? a.status === "proposed"
            ? "verified"
            : a.status
          : a.status,
    })),
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

export function verificationPassed(flags: VerificationFlags): boolean {
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
