import { createHash } from "node:crypto";
import type { CanonicalDocument } from "@actionmanifest/schema";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalText(doc: CanonicalDocument): string {
  if (doc.text && doc.text.length > 0) return doc.text;
  if (doc.pages && doc.pages.length > 0) {
    return doc.pages
      .slice()
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((p) => p.text)
      .join("\n");
  }
  if (doc.chunks && doc.chunks.length > 0) {
    return doc.chunks.map((c) => c.text).join("\n");
  }
  return "";
}

export function ensureSourceHash(doc: CanonicalDocument): CanonicalDocument {
  const text = canonicalText(doc);
  const hash = sha256Hex(text);
  return { ...doc, sourceHash: doc.sourceHash ?? hash, text: text || doc.text };
}

export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, "").replace(/[「」『』""']/g, "");
}

export function sourceContainsQuote(source: string, quote: string): boolean {
  if (!quote.trim()) return false;
  const nSource = normalizeForMatch(source);
  const nQuote = normalizeForMatch(quote);
  if (nQuote.length === 0) return false;
  if (nSource.includes(nQuote)) return true;
  // Allow a slightly trimmed quote (punctuation-only tails).
  const trimmed = nQuote.replace(/[。．.、,，!！?？]$/u, "");
  return trimmed.length >= 8 && nSource.includes(trimmed);
}
