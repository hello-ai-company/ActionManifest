import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";

/** Experimental consumer boundary; does not grant verification or execution authority. */
export interface SourceSnapshot { id: string; text: string; deleted?: boolean }
export interface EvidencePin { sourceId: string; sha256: string; quote: string; start?: number }
export type FreshnessReason = "fresh" | "changed_source" | "missing_source" |
  "ambiguous_source" | "invalid_pin" | "quote_missing" | "cancelled" | "deleted_source";
export interface FreshnessResult { sourceId: string; reason: FreshnessReason; usable: boolean }

/** Exact UTF-8 identity: do not normalize Unicode, dates, negations or table cells. */
export function pinEvidence(source: SourceSnapshot, quote: string, start = source.text.indexOf(quote)): EvidencePin {
  checkLimits([{ sourceId: source.id, sha256: "", quote }], [source]);
  if (source.deleted || !validUnicode(source.id) || !validUnicode(source.text) || !validUnicode(quote) || !source.id.trim() || !quote.trim() || !Number.isSafeInteger(start) || start < 0 || source.text.slice(start, start + quote.length) !== quote) {
    throw new Error("Evidence must contain a nonempty exact source quote");
  }
  return { sourceId: source.id, sha256: digest(source.text), quote, start };
}

function validUnicode(value: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}

/** Bounds apply to UTF-16 code units; IDs are opaque, caller-namespaced keys. */
export const FRESHNESS_LIMITS = { sources: 1000, pins: 20000, textUnits: 25000000, quoteUnits: 4096, totalQuoteUnits: 2000000, idUnits: 1024 } as const;

function checkLimits(pins: readonly EvidencePin[], sources: readonly SourceSnapshot[]): void {
  if (sources.length > FRESHNESS_LIMITS.sources || pins.length > FRESHNESS_LIMITS.pins) throw new RangeError("Freshness item limit exceeded");
  let textUnits = 0;
  let quoteUnits = 0;
  for (const source of sources) {
    textUnits += source.text.length;
    if (source.id.length > FRESHNESS_LIMITS.idUnits || !validUnicode(source.id) || !validUnicode(source.text) || !source.id.trim()) throw new RangeError("Invalid source identity or Unicode");
    if (textUnits > FRESHNESS_LIMITS.textUnits) throw new RangeError("Freshness text limit exceeded");
  }
  for (const pin of pins) {
    quoteUnits += pin.quote.length;
    if (pin.sourceId.length > FRESHNESS_LIMITS.idUnits || pin.quote.length > FRESHNESS_LIMITS.quoteUnits || quoteUnits > FRESHNESS_LIMITS.totalQuoteUnits) throw new RangeError("Freshness evidence limit exceeded");
  }
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Hash each current source once; duplicate IDs fail closed, regardless of content.
 * Caller supplies canonical text, not PDF/DOCX bytes. This checks freshness only.
 */
function* freshnessSteps(
  pins: readonly EvidencePin[],
  sources: readonly SourceSnapshot[],
  signal?: AbortSignal,
): Generator<void, FreshnessResult[]> {
  checkLimits(pins, sources);
  const index = new Map<string, { text: string; hash: string; deleted?: boolean } | null>();
  for (const source of sources) {
    if (signal?.aborted) break;
    if (index.has(source.id)) index.set(source.id, null);
    else index.set(source.id, { text: source.text, hash: digest(source.text), deleted: source.deleted });
    yield;
  }
  const results: FreshnessResult[] = [];
  const cached = new Map<string, FreshnessReason>();
  for (const pin of pins) {
    let reason: FreshnessReason;
    const source = index.get(pin.sourceId);
    if (signal?.aborted) reason = "cancelled";
    else if (!validUnicode(pin.sourceId) || !validUnicode(pin.quote) || !pin.sourceId.trim() || !/^[a-f0-9]{64}$/.test(pin.sha256) || !pin.quote.trim() || (pin.start !== undefined && (!Number.isSafeInteger(pin.start) || pin.start < 0))) reason = "invalid_pin";
    else if (source === undefined) reason = "missing_source";
    else if (source === null) reason = "ambiguous_source";
    else if (source.deleted) reason = "deleted_source";
    else if (source.hash !== pin.sha256) reason = "changed_source";
    else {
      const key = JSON.stringify([pin.sourceId, pin.quote, pin.start]);
      reason = cached.get(key) ?? ((pin.start !== undefined ? source.text.slice(pin.start, pin.start + pin.quote.length) === pin.quote : source.text.includes(pin.quote)) ? "fresh" : "quote_missing");
      cached.set(key, reason);
    }
    results.push({ sourceId: pin.sourceId, reason, usable: reason === "fresh" });
    yield;
  }
  return signal?.aborted ? results.map((r) => ({ ...r, reason: "cancelled", usable: false })) : results;
}

/** Synchronous variant: supports pre-abort only for normal event-loop signals. */
export function checkEvidenceFreshness(pins: readonly EvidencePin[], sources: readonly SourceSnapshot[], signal?: AbortSignal): FreshnessResult[] {
  const steps = freshnessSteps(pins, sources, signal);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Cooperative variant: yield every 32 items; aborted runs return no usable evidence. */
export async function checkEvidenceFreshnessAsync(pins: readonly EvidencePin[], sources: readonly SourceSnapshot[], signal?: AbortSignal): Promise<FreshnessResult[]> {
  const steps = freshnessSteps(pins, sources, signal);
  let count = 0;
  let step = steps.next();
  while (!step.done) {
    if (++count % 32 === 0) await setImmediate();
    step = steps.next();
  }
  return step.value;
}
