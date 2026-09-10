import {
  InvalidDocumentError,
  MalformedAdapterPayloadError,
  MissingSourceIdError,
  MultipleDocumentsError,
  assertCanonicalDocument,
  ensureSourceHash,
  type CanonicalChunk,
  type CanonicalDocument,
  type CanonicalPage,
} from "@actionmanifest/core";

/** Version of this adapter's Xberg→Canonical mapping (not the schema version). */
export const XBERG_ADAPTER_VERSION = "1.0.0";

export interface XbergMapOptions {
  /**
   * Stable source identity supplied by the CALLER. Xberg's internal element /
   * result identities are never used as document identity — the chain
   * CanonicalDocument.id → Manifest.source.id → Evidence.source_id must point
   * back to the real source document.
   */
  sourceId: string;
  title?: string;
  language?: string;
}

/**
 * Pure mapping layer (Layer A): Xberg ExtractionResult JSON → CanonicalDocument.
 *
 * No Xberg runtime, no native binding, no network — the payload is validated
 * structurally. This function never extracts Actions (adapter responsibility
 * ends at parse/normalize) and never invents provenance:
 *
 * Stability: Layer A is the **stable structural mapper** of this package —
 * it is NOT experimental (unlike the Layer B native runtime bridge,
 * `XbergAdapter`, which is `@experimental` for the 0.x line) and follows the
 * normal 0.x compatibility policy. The mapper itself loads no native code;
 * the package-level Node >= 22 requirement exists for the optional bridge.
 *
 * - pages are mapped only when Xberg produced per-page content;
 * - chunk page numbers come only from element metadata;
 * - bboxes are OMITTED: Xberg coordinates are in an unspecified document
 *   coordinate space with no page dimensions, so they cannot be safely
 *   normalized into the canonical 0..1 page-relative convention (unknown
 *   stays unknown);
 * - unknown fields are preserved under metadata.upstream_* when useful.
 *
 * Multi-document results (archives) are rejected explicitly — never
 * silently concatenated.
 */
export function mapXbergResultToCanonical(
  payload: unknown,
  options: XbergMapOptions,
): CanonicalDocument {
  if (!options.sourceId || options.sourceId.trim().length === 0) {
    throw new MissingSourceIdError(
      "mapXbergResultToCanonical requires options.sourceId — Xberg-internal result/element identities are not source document identity.",
    );
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new MalformedAdapterPayloadError("Xberg payload must be an ExtractionResult object", {
      received: typeof payload,
    });
  }
  const raw = payload as Record<string, unknown>;
  const results = raw.results;
  if (results !== undefined && !Array.isArray(results)) {
    throw new MalformedAdapterPayloadError("Xberg ExtractionResult.results must be an array");
  }
  const list = (results ?? []) as unknown[];
  const errors = Array.isArray(raw.errors) ? raw.errors : [];

  if (list.length > 1) {
    throw new MultipleDocumentsError(
      `Xberg result contains ${list.length} documents; one source input must map to one CanonicalDocument. Split archives upstream or map each document separately.`,
      { documents: list.length },
    );
  }
  if (list.length === 0) {
    throw new InvalidDocumentError(
      "Xberg result contains no documents (EMPTY_DOCUMENT)" +
        (errors.length ? `; upstream reported ${errors.length} error(s)` : ""),
      { issues: [{ code: "EMPTY_DOCUMENT", message: "no documents in result", severity: "error" }], upstreamErrors: errors },
    );
  }

  const doc = list[0] as Record<string, unknown>;
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new MalformedAdapterPayloadError("Xberg ExtractedDocument must be an object");
  }

  const warnings: string[] = [];
  if (errors.length > 0) {
    warnings.push(`upstream reported ${errors.length} non-fatal extraction error(s)`);
  }

  // --- text ---
  const elements = parseElements(doc.elements);
  let text = typeof doc.content === "string" ? doc.content : undefined;
  if ((!text || text.trim().length === 0) && elements.length > 0) {
    text = elements.map((e) => e.text).join("\n");
    warnings.push("content missing; text composed from elements");
  }
  if (!text || text.trim().length === 0) {
    throw new InvalidDocumentError("Xberg document has no text content (EMPTY_DOCUMENT)", {
      issues: [{ code: "EMPTY_DOCUMENT", message: "no content or elements text", severity: "error" }],
    });
  }

  // --- pages (only when Xberg actually produced per-page content) ---
  const pages: CanonicalPage[] = [];
  if (Array.isArray(doc.pages)) {
    for (const p of doc.pages) {
      if (typeof p !== "object" || p === null) {
        throw new MalformedAdapterPayloadError("Xberg pages[] entries must be objects");
      }
      const page = p as Record<string, unknown>;
      const pageNumber = page.pageNumber;
      if (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1) {
        throw new MalformedAdapterPayloadError(
          "Xberg pages[].pageNumber must be a positive integer",
          { pageNumber },
        );
      }
      pages.push({ pageNumber, text: typeof page.content === "string" ? page.content : "" });
    }
  }

  // --- chunks from semantic elements (heading → section tracking) ---
  const chunks: CanonicalChunk[] = [];
  let currentSection: string | undefined;
  for (const el of elements) {
    const isHeading = el.elementType === "title" || el.elementType === "heading";
    if (isHeading) currentSection = el.text;
    const section = isHeading ? el.text : currentSection;
    chunks.push({
      text: el.text,
      // Page only when upstream provides it — never assumed (no page-1 invention).
      ...(el.pageNumber != null ? { pageNumber: el.pageNumber } : {}),
      // bbox omitted: Xberg coordinates lack a known coordinate system and
      // page dimensions, so they cannot be normalized safely.
      ...(section ? { section } : {}),
      sourceReference: el.elementId,
    });
  }

  // --- metadata ---
  const docMeta = (typeof doc.metadata === "object" && doc.metadata !== null
    ? doc.metadata
    : {}) as Record<string, unknown>;
  const detectedLanguages = Array.isArray(doc.detectedLanguages) ? doc.detectedLanguages : [];
  const language =
    options.language ??
    (typeof detectedLanguages[0] === "string" ? detectedLanguages[0] : undefined) ??
    (typeof docMeta.language === "string" ? docMeta.language : undefined);

  const titleElement = elements.find((e) => e.elementType === "title");
  const title =
    options.title ??
    (typeof docMeta.title === "string" ? docMeta.title : undefined) ??
    titleElement?.text;

  const metadata: Record<string, unknown> = {
    adapter: "xberg",
    adapter_version: XBERG_ADAPTER_VERSION,
    source_format: "xberg-extraction-result",
  };
  if (typeof doc.extractionMethod === "string") metadata.upstream_extraction_method = doc.extractionMethod;
  if (typeof doc.counts === "object" && doc.counts !== null) metadata.upstream_counts = doc.counts;
  if (typeof doc.qualityScore === "number") metadata.upstream_quality_score = doc.qualityScore;
  if (warnings.length > 0) metadata.warnings = warnings;

  return assertCanonicalDocument(
    ensureSourceHash({
      id: options.sourceId,
      ...(title ? { title } : {}),
      ...(typeof doc.mimeType === "string" ? { mediaType: doc.mimeType } : {}),
      ...(language ? { language } : {}),
      text,
      pages: pages.length ? pages : undefined,
      chunks: chunks.length ? chunks : undefined,
      metadata,
    }),
  );
}

interface ParsedElement {
  elementId: string;
  elementType: string;
  text: string;
  pageNumber?: number;
}

function parseElements(raw: unknown): ParsedElement[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new MalformedAdapterPayloadError("Xberg elements must be an array");
  }
  const out: ParsedElement[] = [];
  raw.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new MalformedAdapterPayloadError(`Xberg elements[${i}] must be an object`);
    }
    const el = entry as Record<string, unknown>;
    if (typeof el.text !== "string" || el.text.length === 0) {
      throw new MalformedAdapterPayloadError(`Xberg elements[${i}].text must be a non-empty string`);
    }
    if (typeof el.elementId !== "string" || el.elementId.length === 0) {
      throw new MalformedAdapterPayloadError(`Xberg elements[${i}].elementId must be a non-empty string`);
    }
    const meta = (typeof el.metadata === "object" && el.metadata !== null
      ? el.metadata
      : {}) as Record<string, unknown>;
    const pageNumber = meta.pageNumber;
    if (pageNumber !== undefined && (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1)) {
      throw new MalformedAdapterPayloadError(
        `Xberg elements[${i}].metadata.pageNumber must be a positive integer`,
        { pageNumber },
      );
    }
    out.push({
      elementId: el.elementId,
      elementType: typeof el.elementType === "string" ? el.elementType : "unknown",
      text: el.text,
      ...(pageNumber !== undefined ? { pageNumber: pageNumber as number } : {}),
    });
  });
  return out;
}
