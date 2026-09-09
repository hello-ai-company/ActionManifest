import {
  DocumentAdapterError,
  NotImplementedError,
  ensureSourceHash,
  type CanonicalChunk,
  type CanonicalDocument,
  type CanonicalPage,
} from "@actionmanifest/core";
import type { AdapterInput, DocumentAdapter } from "./types.js";

/**
 * Docling adapter — interface + fixture mapping only in Phase 1.
 * Live Docling/Python execution is out of scope (Docling is upstream).
 *
 * Accepted fixture shape (synthetic):
 * {
 *   "name"?: string,
 *   "texts": [{ "text": string, "page_no"?: number, "orig"?: string }],
 *   "pages"?: [{ "page_no": number, "text": string }]
 * }
 */
export class DoclingAdapter implements DocumentAdapter {
  readonly id = "docling";

  canHandle(input: AdapterInput): boolean {
    return input.kind === "docling-json";
  }

  async toCanonical(input: AdapterInput): Promise<CanonicalDocument> {
    if (input.kind !== "docling-json") {
      throw new DocumentAdapterError(
        "DoclingAdapter expects kind: docling-json. Live PDF bytes are not parsed in Phase 1.",
      );
    }
    return mapDoclingFixture(input.payload, input.id, input.title);
  }
}

export function mapDoclingFixture(
  payload: unknown,
  id = "docling-fixture",
  title?: string,
): CanonicalDocument {
  if (!payload || typeof payload !== "object") {
    throw new DocumentAdapterError("Docling fixture must be an object");
  }
  const raw = payload as Record<string, unknown>;

  const pages: CanonicalPage[] = [];
  const chunks: CanonicalChunk[] = [];

  if (Array.isArray(raw.pages)) {
    for (const p of raw.pages) {
      if (!p || typeof p !== "object") continue;
      const page = p as Record<string, unknown>;
      const pageNumber = Number(page.page_no ?? page.pageNumber ?? 1);
      const text = String(page.text ?? "");
      pages.push({ pageNumber, text });
    }
  }

  if (Array.isArray(raw.texts)) {
    for (const t of raw.texts) {
      if (!t || typeof t !== "object") continue;
      const item = t as Record<string, unknown>;
      const text = String(item.text ?? item.orig ?? "");
      const pageNumber = item.page_no != null ? Number(item.page_no) : undefined;
      chunks.push({
        text,
        pageNumber,
        sourceReference: typeof item.self_ref === "string" ? item.self_ref : undefined,
      });
    }
  }

  const text =
    (typeof raw.text === "string" ? raw.text : undefined) ??
    (pages.length ? pages.map((p) => p.text).join("\n") : chunks.map((c) => c.text).join("\n"));

  if (!text) {
    throw new NotImplementedError(
      "Docling live conversion is not implemented in Phase 1. Provide a texts/pages fixture, or use the Plain Text adapter.",
    );
  }

  if (pages.length === 0) {
    pages.push({ pageNumber: 1, text, chunks });
  }

  return ensureSourceHash({
    id: String(raw.name ?? id),
    title: title ?? (typeof raw.name === "string" ? raw.name : undefined),
    text,
    pages,
    chunks: chunks.length ? chunks : undefined,
    metadata: { adapter: "docling", fixture: true },
  });
}
