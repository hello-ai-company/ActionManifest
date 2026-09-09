import { SCHEMA_VERSION, type CanonicalDocument } from "@actionmanifest/core";
import type { LlmCompletionRequest, LlmProvider } from "./provider.js";
import { extractDeterministically } from "./deterministic.js";

export class DeterministicProvider implements LlmProvider {
  readonly id = "deterministic";
  readonly model = "notice-rules-v0.1";
  constructor(private readonly doc: CanonicalDocument) {}

  async complete(_request: LlmCompletionRequest): Promise<string> {
    const actions = extractDeterministically(this.doc);
    return JSON.stringify({
      schema_version: SCHEMA_VERSION,
      actions,
    });
  }
}
