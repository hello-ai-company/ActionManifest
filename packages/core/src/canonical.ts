import type {
  BoundingBox,
  CanonicalChunk,
  CanonicalDocument,
} from "@actionmanifest/schema";
import { normalizeForMatch } from "./hash.js";
import { InvalidDocumentError } from "./errors.js";
import { validateCanonicalDocument } from "./validate.js";

/**
 * Canonical bbox convention (docs/INTEGRATION-CONTRACT.md): every coordinate is
 * normalized to 0..1 relative to the page it belongs to, origin top-left,
 * x→right, y→down, `{x, y}` = top-left corner, `width`/`height` = extent.
 * A small epsilon absorbs float dust from parser arithmetic.
 */
export const CANONICAL_BBOX_MIN = 0;
export const CANONICAL_BBOX_MAX = 1;
const BBOX_EPSILON = 1e-6;

export type CanonicalIssueCode =
  | "EMPTY_DOCUMENT"
  | "DUPLICATE_PAGE_NUMBER"
  | "INVALID_BBOX"
  | "INVALID_SOURCE_HASH"
  | "CHUNK_PAGE_UNKNOWN"
  | "TEXT_PAGES_MISMATCH";

export interface CanonicalDocumentIssue {
  code: CanonicalIssueCode;
  message: string;
  /** JSON-path-ish location, e.g. `pages[2]` or `chunks[0].bbox`. */
  path?: string;
  severity: "error" | "warning";
}

function issue(
  code: CanonicalIssueCode,
  message: string,
  path?: string,
  severity: "error" | "warning" = "error",
): CanonicalDocumentIssue {
  return { code, message, ...(path ? { path } : {}), severity };
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function isCanonicalBoundingBox(bbox: BoundingBox): boolean {
  const { x, y, width, height } = bbox;
  const values = [x, y, width, height];
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  if (width < 0 || height < 0) return false;
  if (x < CANONICAL_BBOX_MIN - BBOX_EPSILON || y < CANONICAL_BBOX_MIN - BBOX_EPSILON) return false;
  if (x + width > CANONICAL_BBOX_MAX + BBOX_EPSILON) return false;
  if (y + height > CANONICAL_BBOX_MAX + BBOX_EPSILON) return false;
  return true;
}

function checkChunks(
  chunks: CanonicalChunk[],
  knownPages: Set<number> | undefined,
  basePath: string,
  issues: CanonicalDocumentIssue[],
): void {
  chunks.forEach((chunk, i) => {
    const path = `${basePath}[${i}]`;
    if (chunk.pageNumber != null && knownPages && knownPages.size > 0 && !knownPages.has(chunk.pageNumber)) {
      issues.push(
        issue(
          "CHUNK_PAGE_UNKNOWN",
          `chunk references page ${chunk.pageNumber} which is not present in pages[]`,
          `${path}.pageNumber`,
        ),
      );
    }
    if (chunk.bbox && !isCanonicalBoundingBox(chunk.bbox)) {
      issues.push(
        issue(
          "INVALID_BBOX",
          "bbox must be finite, non-negative, and within the canonical 0..1 normalized page convention",
          `${path}.bbox`,
        ),
      );
    }
  });
}

/**
 * Semantic checks on a CanonicalDocument, beyond the JSON Schema. External
 * input is not trusted: adapters run this on their output and third parties
 * SHOULD run it on any document received across a trust boundary.
 *
 * Error-severity issues mean the document violates the integration contract;
 * warnings are informational and never block.
 */
export function checkCanonicalDocument(doc: CanonicalDocument): CanonicalDocumentIssue[] {
  const issues: CanonicalDocumentIssue[] = [];

  const hasText = typeof doc.text === "string" && doc.text.trim().length > 0;
  const pages = doc.pages ?? [];
  const chunks = doc.chunks ?? [];
  const hasPageText = pages.some((p) => p.text.trim().length > 0);
  const hasChunkText = chunks.some((c) => c.text.trim().length > 0);
  if (!hasText && !hasPageText && !hasChunkText) {
    issues.push(
      issue("EMPTY_DOCUMENT", "CanonicalDocument has no text, page text, or chunk text"),
    );
  }

  const pageNumbers = pages.map((p) => p.pageNumber);
  const seenPages = new Set<number>();
  pages.forEach((page, i) => {
    if (seenPages.has(page.pageNumber)) {
      issues.push(
        issue(
          "DUPLICATE_PAGE_NUMBER",
          `pageNumber ${page.pageNumber} appears more than once`,
          `pages[${i}].pageNumber`,
        ),
      );
    }
    seenPages.add(page.pageNumber);
  });
  const knownPages = pages.length > 0 ? new Set(pageNumbers) : undefined;
  pages.forEach((page, i) => checkChunks(page.chunks ?? [], knownPages, `pages[${i}].chunks`, issues));
  checkChunks(chunks, knownPages, "chunks", issues);

  if (doc.sourceHash != null && !SHA256_HEX.test(doc.sourceHash)) {
    issues.push(
      issue(
        "INVALID_SOURCE_HASH",
        "sourceHash must be a lowercase SHA-256 hex string (64 chars)",
        "sourceHash",
      ),
    );
  }

  if (hasText && hasPageText) {
    const joined = pages
      .slice()
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((p) => p.text)
      .join("\n");
    if (normalizeForMatch(joined) !== normalizeForMatch(doc.text ?? "")) {
      issues.push(
        issue(
          "TEXT_PAGES_MISMATCH",
          "document text differs from the concatenation of pages[].text; canonicalText() prefers document text",
          "text",
          "warning",
        ),
      );
    }
  }

  return issues;
}

/**
 * Schema + semantic validation in one call. Throws {@link InvalidDocumentError}
 * (code `INVALID_DOCUMENT`) listing every error-severity issue; never returns
 * a partial or silently-repaired document.
 */
export function assertCanonicalDocument(data: unknown): CanonicalDocument {
  const doc = validateCanonicalDocument(data);
  const issues = checkCanonicalDocument(doc);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new InvalidDocumentError(
      `CanonicalDocument violates the integration contract: ${errors
        .map((i) => `${i.code}${i.path ? ` at ${i.path}` : ""}`)
        .join("; ")}`,
      { issues },
    );
  }
  return doc;
}

export interface EvidenceLocation {
  page?: number;
  bbox?: BoundingBox;
  section?: string;
  sourceReference?: string;
}

function containsQuote(haystack: string, quote: string): boolean {
  const nHaystack = normalizeForMatch(haystack);
  const nQuote = normalizeForMatch(quote);
  return nQuote.length > 0 && nHaystack.includes(nQuote);
}

/**
 * Locate a quote inside a CanonicalDocument, preferring the finest granularity
 * (chunk → page). Returns `undefined` when the quote cannot be located — the
 * caller must then omit locators instead of inventing them (unknown stays
 * unknown).
 */
export function locateEvidence(
  doc: CanonicalDocument,
  quote: string,
): EvidenceLocation | undefined {
  const chunkSources: CanonicalChunk[] = [
    ...(doc.pages ?? []).flatMap((p) =>
      (p.chunks ?? []).map((c) => ({ pageNumber: p.pageNumber, ...c })),
    ),
    ...(doc.chunks ?? []),
  ];
  for (const chunk of chunkSources) {
    if (!chunk.text || !containsQuote(chunk.text, quote)) continue;
    return {
      ...(chunk.pageNumber != null ? { page: chunk.pageNumber } : {}),
      ...(chunk.bbox ? { bbox: chunk.bbox } : {}),
      ...(chunk.section ? { section: chunk.section } : {}),
      ...(chunk.sourceReference ? { sourceReference: chunk.sourceReference } : {}),
    };
  }
  for (const page of doc.pages ?? []) {
    if (containsQuote(page.text, quote)) return { page: page.pageNumber };
  }
  return undefined;
}
