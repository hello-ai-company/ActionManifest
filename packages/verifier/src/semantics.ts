import type { Action, Temporal } from "@actionmanifest/core";
import {
  conditionalClauses,
  isCancellationContext,
  isCorrectionContext,
  isNegation,
  parseTemporals,
  primaryTemporal,
  type YearContext,
} from "@actionmanifest/temporal";

function flattenTemporals(t?: Temporal): Temporal[] {
  return t ? [t, ...(t.alternatives ?? []).flatMap(flattenTemporals)] : [];
}

export function evidenceCorpus(action: Action): string {
  return action.evidence.map(e => e.text).join("\n");
}

/** A document can supply a missing year, never an unrelated action's date. */
export function temporalEvidenceSupported(action: Action, year: YearContext): boolean {
  const temporals = flattenTemporals(action.temporal);
  if (temporals.some(t => t.type === "approximate" && t.date)) return false;
  const exact = temporals.filter(t => t.date);
  if (!exact.length) return true;
  const corpus = evidenceCorpus(action);
  const dates = new Set(parseTemporals(corpus, year).map(t => t.date).filter(Boolean));
  if (exact.some(t => !dates.has(t.date))) return false;
  // A superseded date is a real quote but no longer supports an active deadline.
  const corrections = action.evidence.filter(e => isCorrectionContext(e.text));
  if (corrections.length) {
    // Original evidence may be retained for eligibility/actor provenance. It is
    // not a second active date: only an explicit correction quote can replace it.
    const replacements = corrections.map(e => primaryTemporal(e.text, year)?.date);
    if (replacements.some(date => !date) || new Set(replacements).size !== 1) return false;
    if (exact.some(t => t.date !== replacements[0])) return false;
  }
  return true;
}

/** Negation applies to preparation/payment/etc., not just submissions. */
export function negationConflict(action: Action): boolean {
  if (action.modality === "prohibited" || action.modality !== "required") return false;
  const corpus = evidenceCorpus(action);
  const conditions = (action.conditions ?? []).join(" ");
  if (!(isNegation(corpus) || /提出不要|提出は不要/.test(corpus) || isNegation(conditions))) return false;
  // An exemption needs source support as well as an extraction condition.
  // A fabricated "exemption" label cannot override a blanket withdrawal.
  const negatedClauses = corpus.split(/(?<=[。！？.!?])\s*|\n+/).filter(clause =>
    isNegation(clause) || /提出不要|提出は不要/.test(clause));
  const sourceExemption = negatedClauses.length > 0 && negatedClauses.every(clause =>
    /再提出|already submitted|提出した方|提出済み/i.test(clause));
  const scopedExemption = /再提出|already submitted|提出した方|提出済み/i.test(conditions);
  return !(action.kind === "submit" && sourceExemption && scopedExemption);
}

function predicate(text: string): string {
  return text.replace(/\s+/g, "").replace(/(?:の)?(?:場合|とき)(?:に限り|のみ|だけ)?(?:には|は)?$/, "");
}

/** These conditions must survive in the Action, not only in its evidence quote. */
export function conditionsSupported(action: Action): boolean {
  if (action.modality === "prohibited" || action.kind === "event") return true;
  const required = conditionalClauses(evidenceCorpus(action));
  return required.every(clause => (action.conditions ?? []).some(condition =>
    predicate(condition) === predicate(clause)));
}

export function cancellationConflict(action: Action): boolean {
  return action.modality !== "prohibited" &&
    (action.kind === "event" || action.kind === "attend") &&
    isCancellationContext(evidenceCorpus(action));
}
