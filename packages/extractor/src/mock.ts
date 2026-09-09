import type { LlmCompletionRequest, LlmProvider } from "./provider.js";

/** Scripted provider for deterministic CI. Never calls the network. */
export class MockProvider implements LlmProvider {
  readonly id = "mock";
  readonly model: string;
  constructor(
    private readonly responder: (request: LlmCompletionRequest) => string,
    model = "mock-v0",
  ) {
    this.model = model;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    return this.responder(request);
  }
}

export class FixtureJsonProvider implements LlmProvider {
  readonly id = "fixture-json";
  readonly model = "fixture";
  constructor(private readonly json: string) {}
  async complete(): Promise<string> {
    return this.json;
  }
}
