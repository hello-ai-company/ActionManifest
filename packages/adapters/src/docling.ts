import {
  InvalidBoundingBoxError,
  InvalidDocumentError,
  InvalidPageError,
  MalformedAdapterPayloadError,
  MissingSourceIdError,
  NotImplementedError,
  UnsupportedInputError,
  assertCanonicalDocument,
  ensureSourceHash,
  type BoundingBox,
  type CanonicalChunk,
  type CanonicalDocument,
  type CanonicalPage,
} from "@actionmanifest/core";
import type { AdapterInput, DocumentAdapter } from "./types.js";

/** Version of this adapter's Docling→Canonical mapping (not the schema version). */
export const DOCLING_ADAPTER_VERSION = "2.0.0";

/**
 * Docling reference adapter (Phase 2).
 *
 * Boundary: Docling (Python, upstream) runs OUTSIDE ActionManifest and emits
 * JSON (`DoclingDocument.export_to_dict()`). This adapter converts that JSON
 * into a CanonicalDocument — nothing more. Core never depends on Docling, and
 * this adapter never extracts Actions.
 *
 * Accepted input (structural subset of the Docling document dict):
 * ```jsonc
 * {
 *   "schema_name": "DoclingDocument",     // optional marker
 *   "name": "doc-id",                      // source identity (or pass input.id)
 *   "origin": { "mimetype": "application/pdf" },
 *   "texts": [
 *     {
 *       "self_ref": "#/texts/0",
 *       "label": "section_header" | "title" | "paragraph" | "list_item" | …,
 *       "text": "…",                        // or "orig"
 *       "prov": [{ "page_no": 1, "bbox": { "l", "t", "r", "b", "coord_origin" } }]
 *     }
 *   ],
 *   "pages": { "1": { "page_no": 1, "size": { "width": 612, "height": 792 } } }
 * }
 * ```
 *
 * The Phase 1 fixture shorthand (`pages` as an array, `texts[].page_no`) keeps
 * working; it simply has no geometry, so no bboxes are produced.
 *
 * bbox normalization: Docling bboxes are converted to the canonical 0..1
 * page-relative convention ONLY when the coordinate origin is known
 * (`TOPLEFT`/`BOTTOMLEFT`) and the target page declares a positive size.
 * Otherwise the bbox is omitted (unknown stays unknown) and a warning is
 * recorded in `metadata.warnings`.
 */
export class DoclingAdapter implements DocumentAdapter {
  readonly id = "docling";

  canHandle(input: AdapterInput): boolean {
    return input.kind === "docling-json";
  }

  async toCanonical(input: AdapterInput): Promise<CanonicalDocument> {
    if (input.kind !== "docling-json") {
      throw new UnsupportedInputError(
        "DoclingAdapter expects kind: docling-json (parsed Docling JSON output). Live PDF bytes are out of scope.",
        { received: input.kind },
      );
    }
    return mapDoclingDocument(input.payload, { id: input.id, title: input.title });
  }
}

export interface DoclingMapOptions {
  id?: string;
  title?: string;
}

interface RawProv {
  page_no?: unknown;
  bbox?: unknown;
}

interface PageInfo {
  pageNumber: number;
  width?: number;
  height?: number;
  text?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asPageNumber(v: unknown, path: string): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new InvalidPageError(`Docling provenance page_no must be a positive integer at ${path}`, {
      value: v,
    });
  }
  return n;
}

function parsePages(raw: unknown): { pages: PageInfo[]; declared: boolean } {
  if (raw == null) return { pages: [], declared: false };
  // Realistic Docling shape: object keyed by page number.
  if (isRecord(raw)) {
    const pages = Object.entries(raw).map(([key, value]) => {
      if (!isRecord(value)) {
        throw new MalformedAdapterPayloadError(`pages["${key}"] must be an object`);
      }
      const pageNumber = asPageNumber(value.page_no ?? key, `pages["${key}"].page_no`);
      const size = value.size;
      let width: number | undefined;
      let height: number | undefined;
      if (size != null) {
        if (!isRecord(size)) {
          throw new MalformedAdapterPayloadError(`pages["${key}"].size must be an object`);
        }
        width = typeof size.width === "number" ? size.width : undefined;
        height = typeof size.height === "number" ? size.height : undefined;
      }
      const text = typeof value.text === "string" ? value.text : undefined;
      return { pageNumber, width, height, text };
    });
    return { pages, declared: true };
  }
  // Phase 1 fixture shorthand: array of { page_no, text }.
  if (Array.isArray(raw)) {
    const pages = raw.map((value, i) => {
      if (!isRecord(value)) {
        throw new MalformedAdapterPayloadError(`pages[${i}] must be an object`);
      }
      const pageNumber = asPageNumber(value.page_no ?? value.pageNumber ?? i + 1, `pages[${i}].page_no`);
      const text = typeof value.text === "string" ? value.text : "";
      return { pageNumber, text };
    });
    return { pages, declared: true };
  }
  throw new MalformedAdapterPayloadError("pages must be an object keyed by page number or an array");
}

interface RawTextItem {
  text: string;
  label?: string;
  selfRef?: string;
  provs: { pageNumber: number; bbox?: BoundingBox }[];
}

function parseBbox(
  raw: unknown,
  page: PageInfo | undefined,
  warnings: Set<string>,
  path: string,
): BoundingBox | undefined {
  if (raw == null) return undefined;
  if (!isRecord(raw)) {
    throw new InvalidBoundingBoxError(`Docling bbox must be an object at ${path}`);
  }
  const l = Number(raw.l);
  const t = Number(raw.t);
  const r = Number(raw.r);
  const b = Number(raw.b);
  const origin = typeof raw.coord_origin === "string" ? raw.coord_origin.toUpperCase() : undefined;
  if (![l, t, r, b].every((v) => Number.isFinite(v))) {
    throw new InvalidBoundingBoxError(`Docling bbox l/t/r/b must be finite numbers at ${path}`, {
      bbox: raw,
    });
  }
  if (origin !== "TOPLEFT" && origin !== "BOTTOMLEFT") {
    // Unknown coordinate system: never guess a normalization.
    warnings.add("bbox omitted: unknown coord_origin");
    return undefined;
  }
  // TOPLEFT: t/b measured down from the top edge (b >= t).
  // BOTTOMLEFT: t/b measured up from the bottom edge (t >= b).
  if (r < l || (origin === "TOPLEFT" && b < t) || (origin === "BOTTOMLEFT" && t < b)) {
    throw new InvalidBoundingBoxError(
      `Docling bbox has inverted corners for ${origin} at ${path}`,
      { bbox: raw },
    );
  }
  const width = page?.width;
  const height = page?.height;
  if (width == null || height == null || width <= 0 || height <= 0) {
    // Page geometry unknown: omit rather than fabricate 0..1 numbers.
    warnings.add("bbox omitted: page size unknown");
    return undefined;
  }
  const yTop = origin === "TOPLEFT" ? t : height - t;
  const boxHeight = origin === "TOPLEFT" ? b - t : t - b;
  return {
    x: l / width,
    y: yTop / height,
    width: (r - l) / width,
    height: boxHeight / height,
  };
}

function parseTexts(raw: unknown, pages: PageInfo[], pagesDeclared: boolean, warnings: Set<string>): RawTextItem[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new MalformedAdapterPayloadError("texts must be an array");
  }
  const byNumber = new Map(pages.map((p) => [p.pageNumber, p]));
  const items: RawTextItem[] = [];

  raw.forEach((entry, i) => {
    const path = `texts[${i}]`;
    if (!isRecord(entry)) {
      throw new MalformedAdapterPayloadError(`${path} must be an object`);
    }
    const text = entry.text ?? entry.orig;
    if (text != null && typeof text !== "string") {
      throw new MalformedAdapterPayloadError(`${path}.text must be a string`);
    }
    if (text == null || text.length === 0) {
      // An item with no text carries no content; skipping loses nothing, but an
      // all-empty payload still fails EMPTY_DOCUMENT downstream.
      return;
    }
    const label = typeof entry.label === "string" ? entry.label : undefined;
    const selfRef =
      typeof entry.self_ref === "string"
        ? entry.self_ref
        : typeof entry.selfRef === "string"
          ? entry.selfRef
          : undefined;

    const provs: RawTextItem["provs"] = [];
    const rawProv = entry.prov;
    if (rawProv != null) {
      if (!Array.isArray(rawProv)) {
        throw new MalformedAdapterPayloadError(`${path}.prov must be an array`);
      }
      rawProv.forEach((p, j) => {
        const provPath = `${path}.prov[${j}]`;
        if (!isRecord(p)) {
          throw new MalformedAdapterPayloadError(`${provPath} must be an object`);
        }
        const pageNumber = asPageNumber((p as RawProv).page_no, `${provPath}.page_no`);
        const page = byNumber.get(pageNumber);
        if (pagesDeclared && !page) {
          throw new InvalidPageError(
            `Docling provenance references page ${pageNumber} which is not declared in pages (${provPath})`,
          );
        }
        const bbox = parseBbox((p as RawProv).bbox, page, warnings, `${provPath}.bbox`);
        provs.push({ pageNumber, ...(bbox ? { bbox } : {}) });
      });
    } else if (entry.page_no != null) {
      // Phase 1 fixture shorthand: direct page_no, no geometry.
      provs.push({ pageNumber: asPageNumber(entry.page_no, `${path}.page_no`) });
    }

    items.push({ text, ...(label ? { label } : {}), ...(selfRef ? { selfRef } : {}), provs });
  });
  return items;
}

const HEADING_LABELS = new Set(["section_header", "title"]);

/**
 * Convert a parsed Docling document dict into a CanonicalDocument.
 *
 * @throws MissingSourceIdError when neither options.id nor payload.name is present
 * @throws MalformedAdapterPayloadError on structurally broken payloads
 * @throws InvalidPageError / InvalidBoundingBoxError on broken provenance
 * @throws InvalidDocumentError when the result violates the document contract
 */
export function mapDoclingDocument(payload: unknown, options: DoclingMapOptions = {}): CanonicalDocument {
  if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
    throw new NotImplementedError(
      "DoclingAdapter converts parsed Docling JSON only. Run Docling upstream (Python) and pass document.export_to_dict(); live binary conversion is out of scope for the TypeScript core.",
    );
  }
  if (!isRecord(payload)) {
    throw new MalformedAdapterPayloadError("Docling payload must be a parsed JSON object", {
      received: typeof payload,
    });
  }

  const name = typeof payload.name === "string" ? payload.name : undefined;
  const id = options.id ?? name;
  if (!id) {
    throw new MissingSourceIdError(
      "DoclingAdapter requires a source identity: pass input.id or set payload.name. Evidence.source_id must resolve back to CanonicalDocument.id.",
    );
  }

  const warnings = new Set<string>();
  const { pages: pageInfos, declared: pagesDeclared } = parsePages(payload.pages);

  // Duplicate page numbers must surface before the page map collapses them.
  const seenPageNumbers = new Set<number>();
  for (const p of pageInfos) {
    if (seenPageNumbers.has(p.pageNumber)) {
      throw new InvalidDocumentError(
        `Duplicate page number ${p.pageNumber} in Docling payload`,
        { issues: [{ code: "DUPLICATE_PAGE_NUMBER", message: `pageNumber ${p.pageNumber} appears more than once`, severity: "error" }] },
      );
    }
    seenPageNumbers.add(p.pageNumber);
  }

  const texts = parseTexts(payload.texts, pageInfos, pagesDeclared, warnings);

  // Compose the page list: declared pages ∪ pages referenced by provenance.
  const pageMap = new Map<number, { text: string[]; size?: { width?: number; height?: number } }>();
  for (const p of pageInfos) {
    pageMap.set(p.pageNumber, {
      text: p.text != null ? [p.text] : [],
      size: { width: p.width, height: p.height },
    });
  }
  for (const item of texts) {
    const prov = item.provs[0];
    if (!prov) continue;
    const entry = pageMap.get(prov.pageNumber) ?? { text: [] };
    // Declared page text (array-form shorthand) wins over text-item composition.
    if (!pageInfos.some((p) => p.pageNumber === prov.pageNumber && p.text != null)) {
      entry.text.push(item.text);
    }
    pageMap.set(prov.pageNumber, entry);
  }

  const pages: CanonicalPage[] = [...pageMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, entry]) => ({ pageNumber, text: entry.text.join("\n") }));

  // Chunks with section tracking: a title/section_header sets the section
  // context for the chunks that follow it (reading order as given).
  const chunks: CanonicalChunk[] = [];
  let currentSection: string | undefined;
  for (const item of texts) {
    const prov = item.provs[0];
    const isHeading = item.label != null && HEADING_LABELS.has(item.label);
    if (isHeading) currentSection = item.text;
    const section = isHeading ? item.text : currentSection;
    chunks.push({
      text: item.text,
      ...(prov ? { pageNumber: prov.pageNumber } : {}),
      ...(prov?.bbox ? { bbox: prov.bbox } : {}),
      ...(section ? { section } : {}),
      ...(item.selfRef ? { sourceReference: item.selfRef } : {}),
    });
  }

  const topText = typeof payload.text === "string" && payload.text.length > 0 ? payload.text : undefined;
  // Text items without provenance belong to no page; their content is still
  // part of the document full text (appended after the page flow) so no
  // content is silently dropped, while their chunks carry no page/bbox.
  const unlocated = texts.filter((t) => t.provs.length === 0).map((t) => t.text);
  const text =
    topText ?? [...pages.map((p) => p.text), ...unlocated].filter((s) => s.length > 0).join("\n");

  // Minimal-document compatibility: a payload with only free text still gets a
  // single page so page-based evidence location keeps working.
  if (pages.length === 0 && text.length > 0) {
    pages.push({ pageNumber: 1, text });
  }

  const origin = isRecord(payload.origin) ? payload.origin : undefined;
  const mediaType = typeof origin?.mimetype === "string" ? origin.mimetype : undefined;

  const metadata: Record<string, unknown> = {
    adapter: "docling",
    adapter_version: DOCLING_ADAPTER_VERSION,
    source_format: "docling-json",
  };
  if (typeof payload.schema_name === "string") metadata.docling_schema_name = payload.schema_name;
  if (typeof payload.version === "string") metadata.docling_version = payload.version;
  if (typeof origin?.binary_hash === "number" || typeof origin?.binary_hash === "string") {
    // Upstream hash preserved for provenance only; CanonicalDocument.sourceHash
    // is always recomputed over the canonical text.
    metadata.upstream_binary_hash = origin.binary_hash;
  }
  if (warnings.size > 0) metadata.warnings = [...warnings];

  const doc: CanonicalDocument = {
    id,
    ...(options.title ?? name ? { title: options.title ?? name } : {}),
    ...(mediaType ? { mediaType } : {}),
    text,
    pages: pages.length ? pages : undefined,
    chunks: chunks.length ? chunks : undefined,
    metadata,
  };

  // Fail fast at the trust boundary: never emit a document that violates the
  // contract (empty content, duplicate pages, orphan page refs, bad bbox).
  return assertCanonicalDocument(ensureSourceHash(doc));
}

/**
 * Backward-compatible Phase 1 entry point. Prefer {@link mapDoclingDocument};
 * both accept the Phase 1 fixture shorthand and the Docling document shape.
 */
export function mapDoclingFixture(
  payload: unknown,
  id?: string,
  title?: string,
): CanonicalDocument {
  return mapDoclingDocument(payload, { ...(id ? { id } : {}), ...(title ? { title } : {}) });
}
