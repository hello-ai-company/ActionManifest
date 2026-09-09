export class ActionManifestError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ActionManifestError";
    this.code = code;
    this.details = details;
  }
}

export class SchemaValidationError extends ActionManifestError {
  constructor(message: string, details?: unknown) {
    super("SCHEMA_VALIDATION", message, details);
    this.name = "SchemaValidationError";
  }
}

export class MalformedLlmOutputError extends ActionManifestError {
  constructor(message: string, details?: unknown) {
    super("MALFORMED_LLM_OUTPUT", message, details);
    this.name = "MalformedLlmOutputError";
  }
}

export class ProviderTimeoutError extends ActionManifestError {
  constructor(message: string, details?: unknown) {
    super("PROVIDER_TIMEOUT", message, details);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderError extends ActionManifestError {
  constructor(message: string, details?: unknown) {
    super("PROVIDER_ERROR", message, details);
    this.name = "ProviderError";
  }
}

/**
 * Adapter / document-boundary failures (Phase 2 integration contract).
 *
 * Every failure at the document boundary carries a stable machine-readable
 * `code` so a third-party adapter or consumer can branch without parsing
 * messages. All of them extend {@link DocumentAdapterError}, so existing
 * `instanceof DocumentAdapterError` handlers keep working.
 */
export class DocumentAdapterError extends ActionManifestError {
  constructor(message: string, details?: unknown, code = "DOCUMENT_ADAPTER") {
    super(code, message, details);
    this.name = "DocumentAdapterError";
  }
}

/** The adapter cannot handle the supplied input kind/shape at all. */
export class UnsupportedInputError extends DocumentAdapterError {
  constructor(message: string, details?: unknown) {
    super(message, details, "UNSUPPORTED_INPUT");
    this.name = "UnsupportedInputError";
  }
}

/** The adapter payload is structurally malformed (not the documented shape). */
export class MalformedAdapterPayloadError extends DocumentAdapterError {
  constructor(message: string, details?: unknown) {
    super(message, details, "MALFORMED_ADAPTER_PAYLOAD");
    this.name = "MalformedAdapterPayloadError";
  }
}

/** The produced CanonicalDocument violates the document contract. */
export class InvalidDocumentError extends DocumentAdapterError {
  constructor(message: string, details?: unknown) {
    super(message, details, "INVALID_DOCUMENT");
    this.name = "InvalidDocumentError";
  }
}

/** A page reference is invalid (non-positive, non-numeric, or unknown page). */
export class InvalidPageError extends DocumentAdapterError {
  constructor(message: string, details?: unknown) {
    super(message, details, "INVALID_PAGE");
    this.name = "InvalidPageError";
  }
}

/** A bounding box is malformed or outside the canonical 0..1 convention. */
export class InvalidBoundingBoxError extends DocumentAdapterError {
  constructor(message: string, details?: unknown) {
    super(message, details, "INVALID_BBOX");
    this.name = "InvalidBoundingBoxError";
  }
}

/** A required source identity field (document id / evidence source_id) is missing. */
export class MissingSourceIdError extends DocumentAdapterError {
  constructor(message: string, details?: unknown) {
    super(message, details, "MISSING_SOURCE_ID");
    this.name = "MissingSourceIdError";
  }
}

/** Export refused: the manifest is not consumable under the requested policy. */
export class ExportError extends ActionManifestError {
  constructor(message: string, details?: unknown) {
    super("EXPORT_BLOCKED", message, details);
    this.name = "ExportError";
  }
}

export class VerifierError extends ActionManifestError {
  constructor(message: string, details?: unknown) {
    super("VERIFIER", message, details);
    this.name = "VerifierError";
  }
}

export class NotImplementedError extends ActionManifestError {
  constructor(message: string, details?: unknown) {
    super("NOT_IMPLEMENTED", message, details);
    this.name = "NotImplementedError";
  }
}
