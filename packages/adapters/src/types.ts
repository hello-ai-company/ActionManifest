import type { CanonicalDocument } from "@actionmanifest/core";

/**
 * Built-in adapter inputs (Phase 2 integration contract).
 *
 * This union covers ONLY the built-in reference adapters shipped in this
 * package (plain text, Docling JSON). It is deliberately NOT extensible:
 * third-party adapters define their own input type and implement
 * `DocumentAdapter<TheirInput>` — they never edit this union. Optional
 * isolated packages (e.g. `@actionmanifest/adapter-xberg`) do the same.
 *
 * An adapter's responsibility ends at parse/normalize: it turns an external
 * representation into a CanonicalDocument. It MUST NOT extract Actions —
 * extraction is the extractor's job (`Adapter → CanonicalDocument →
 * ActionExtractor`), so a parser-specific adapter can never smuggle
 * unverifiable Actions into the pipeline.
 *
 * Failure semantics: adapters fail explicitly with a typed
 * `DocumentAdapterError` subclass (`UNSUPPORTED_INPUT`,
 * `MALFORMED_ADAPTER_PAYLOAD`, `INVALID_DOCUMENT`, `INVALID_PAGE`,
 * `INVALID_BBOX`, `MISSING_SOURCE_ID`). Silent fallbacks — e.g. returning an
 * empty CanonicalDocument for a broken payload — are forbidden.
 */
export interface PlainTextInput {
  kind: "text";
  id?: string;
  title?: string;
  text: string;
  language?: string;
}

export interface PathInput {
  kind: "path";
  path: string;
  id?: string;
  title?: string;
  language?: string;
}

export interface DoclingJsonInput {
  kind: "docling-json";
  /** Source identity. Falls back to the payload's `name`; required overall. */
  id?: string;
  title?: string;
  /** Parsed Docling document JSON (`DoclingDocument.export_to_dict()` shape). */
  payload: unknown;
}

/** Inputs understood by the built-in adapters in this package. */
export type AdapterInput = PlainTextInput | PathInput | DoclingJsonInput;

/**
 * The extensible adapter contract. `I` defaults to the built-in
 * {@link AdapterInput} union so existing built-in adapters and consumers keep
 * working unchanged; third-party adapters supply their own input type:
 *
 * ```ts
 * interface MarkerInput { kind: "marker-json"; sourceId: string; payload: unknown }
 * class MarkerAdapter implements DocumentAdapter<MarkerInput> { … }
 * ```
 */
export interface DocumentAdapter<I = AdapterInput> {
  readonly id: string;
  canHandle(input: I): boolean;
  /**
   * Convert input into a contract-valid CanonicalDocument. The returned
   * document MUST satisfy `assertCanonicalDocument` and preserve source
   * identity, page numbers, and (when the input coordinate system is known)
   * bboxes in the canonical normalized 0..1 convention.
   */
  toCanonical(input: I): Promise<CanonicalDocument>;
}
