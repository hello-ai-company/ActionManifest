import type { CanonicalDocument } from "@actionmanifest/core";

/**
 * Adapter inputs (Phase 2 integration contract).
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
export type AdapterInput =
  | { kind: "text"; id?: string; title?: string; text: string; language?: string }
  | { kind: "path"; path: string; id?: string; title?: string; language?: string }
  | {
      kind: "docling-json";
      /** Source identity. Falls back to the payload's `name`; required overall. */
      id?: string;
      title?: string;
      /** Parsed Docling document JSON (`DoclingDocument.export_to_dict()` shape). */
      payload: unknown;
    }
  | {
      /**
       * Xberg runtime input: a local path / file:// URI / bytes extracted via
       * `@xberg-io/xberg`. Handled by `@actionmanifest/adapter-xberg` — the
       * core adapters package only declares the contract shape and carries no
       * Xberg dependency.
       */
      kind: "xberg-uri";
      /** Stable source identity supplied by the caller (never Xberg-internal ids). */
      sourceId: string;
      uri: string;
      title?: string;
      mimeType?: string;
      /**
       * Remote http(s) extraction requires explicit opt-in — the adapter never
       * fetches the network unless the caller set this flag.
       */
      allowRemote?: boolean;
    }
  | {
      kind: "xberg-bytes";
      sourceId: string;
      bytes: Uint8Array;
      filename?: string;
      mimeType?: string;
      title?: string;
    }
  | {
      /** Xberg already ran upstream: map a serialized ExtractionResult. */
      kind: "xberg-result";
      sourceId: string;
      title?: string;
      payload: unknown;
    };

export interface DocumentAdapter {
  readonly id: string;
  canHandle(input: AdapterInput): boolean;
  /**
   * Convert input into a contract-valid CanonicalDocument. The returned
   * document MUST satisfy `assertCanonicalDocument` and preserve source
   * identity, page numbers, and (when the input coordinate system is known)
   * bboxes in the canonical normalized 0..1 convention.
   */
  toCanonical(input: AdapterInput): Promise<CanonicalDocument>;
}
