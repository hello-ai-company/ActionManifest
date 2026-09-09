/**
 * Xberg-specific adapter inputs. These live in THIS package — the central
 * `@actionmanifest/adapters` union stays limited to built-in reference
 * adapters, and Core stays parser-free.
 */
export interface XbergUriInput {
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

export interface XbergBytesInput {
  kind: "xberg-bytes";
  sourceId: string;
  bytes: Uint8Array;
  filename?: string;
  mimeType?: string;
  title?: string;
}

/** Xberg already ran upstream: map a serialized ExtractionResult. */
export interface XbergResultInput {
  kind: "xberg-result";
  sourceId: string;
  title?: string;
  payload: unknown;
}

export type XbergAdapterInput = XbergUriInput | XbergBytesInput | XbergResultInput;
