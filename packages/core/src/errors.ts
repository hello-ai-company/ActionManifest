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

export class DocumentAdapterError extends ActionManifestError {
  constructor(message: string, details?: unknown) {
    super("DOCUMENT_ADAPTER", message, details);
    this.name = "DocumentAdapterError";
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
