/**
 * Reference consumer — the pattern a third-party application should follow.
 *
 * Everything here imports ONLY public package entry points
 * (`@actionmanifest/<pkg>`), exactly as an external app would after
 * `npm install`. No internal paths, no source aliases.
 *
 * Flow: adapter → CanonicalDocument → extractor → verifier → consumer policy
 * → exporters. The consumer trusts the verification receipt, never the
 * extractor; unverified Actions are never executed.
 */
import { DoclingAdapter, PlainTextAdapter } from "@actionmanifest/adapters";
import type { Action, ActionManifest, CanonicalDocument } from "@actionmanifest/core";
import { extractActions } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";
import { classifyManifest, type ConsumableAction } from "@actionmanifest/consumer";
import { exportIcs, exportJson } from "@actionmanifest/exporters";

export interface ConsumeResult {
  doc: CanonicalDocument;
  manifest: ActionManifest;
  report: ReturnType<typeof classifyManifest>;
  /** Only disposition === "ready" actions. */
  ready: Action[];
  /** Verified-only JSON record (receipt included). */
  json: string;
  /** Verified-only iCalendar artifact. */
  ics: string;
}

/** Full pipeline from plain text to safe exports. */
export async function consumePlainText(
  text: string,
  id: string,
): Promise<ConsumeResult> {
  const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id, text });
  return consumeDocument(doc);
}

/** Full pipeline from parsed Docling JSON to safe exports. */
export async function consumeDoclingJson(
  payload: unknown,
  id?: string,
): Promise<ConsumeResult> {
  const doc = await new DoclingAdapter().toCanonical({ kind: "docling-json", ...(id ? { id } : {}), payload });
  return consumeDocument(doc);
}

async function consumeDocument(doc: CanonicalDocument): Promise<ConsumeResult> {
  const candidate = await extractActions(doc);
  const { manifest } = verifyManifest(candidate, doc);
  const report = classifyManifest(manifest);
  const ready = report.actions
    .filter((a): a is ConsumableAction & { disposition: "ready" } => a.disposition === "ready")
    .map((a) => a.action);
  return {
    doc,
    manifest,
    report,
    ready,
    json: exportJson(manifest),
    ics: exportIcs(manifest),
  };
}
