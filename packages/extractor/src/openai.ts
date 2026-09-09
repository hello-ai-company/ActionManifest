import {
  MalformedLlmOutputError,
  ProviderError,
  ProviderTimeoutError,
} from "@actionmanifest/core";
import type { LlmCompletionRequest, LlmProvider } from "./provider.js";

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * OpenAI-compatible chat completions provider.
 * Fail closed: no silent fallback, no runaway retries (default 0).
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly id = "openai-compatible";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: OpenAICompatibleConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 0;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    let lastError: unknown;
    const attempts = 1 + Math.max(0, this.maxRetries);
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.once(request);
      } catch (e) {
        lastError = e;
        if (e instanceof ProviderTimeoutError) throw e;
        if (i === attempts - 1) throw e;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ProviderError("Provider failed", lastError);
  }

  private async once(request: LlmCompletionRequest): Promise<string> {
    const timeoutMs = request.timeoutMs || this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(`HTTP ${res.status} from LLM provider`, {
          status: res.status,
          body: body.slice(0, 500),
        });
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new MalformedLlmOutputError("LLM response missing message content");
      }
      return content;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new ProviderTimeoutError(`LLM provider timed out after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
