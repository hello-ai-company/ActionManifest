import type { Action } from "@actionmanifest/core";

export interface LlmCompletionRequest {
  system: string;
  user: string;
  timeoutMs: number;
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  complete(request: LlmCompletionRequest): Promise<string>;
}

export interface CandidateEnvelope {
  actions: Action[];
}
