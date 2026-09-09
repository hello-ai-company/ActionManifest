import {
  EXTRACTOR_VERSION,
  MalformedLlmOutputError,
  SCHEMA_VERSION,
  canonicalText,
  ensureSourceHash,
  validateActionManifest,
  type Action,
  type ActionManifest,
  type CanonicalDocument,
} from "@actionmanifest/core";
import type { LlmProvider } from "./provider.js";
import { DeterministicProvider } from "./deterministic-provider.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { EXTRACTOR_SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

export interface ExtractOptions {
  provider?: LlmProvider;
  providerName?: "deterministic" | "openai" | "mock";
  timeoutMs?: number;
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fence?.[1]?.trim() ?? trimmed;
}

function parseActionsPayload(raw: string): { actions: Action[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch (e) {
    throw new MalformedLlmOutputError("LLM output is not valid JSON", {
      snippet: raw.slice(0, 400),
      cause: e,
    });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new MalformedLlmOutputError("LLM JSON must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  const actions = obj.actions;
  if (!Array.isArray(actions)) {
    throw new MalformedLlmOutputError("LLM JSON must contain an actions array");
  }
  return { actions: actions as Action[] };
}

export function resolveDefaultProvider(doc: CanonicalDocument): LlmProvider {
  const name = (process.env.ACTIONMAN_PROVIDER ?? "deterministic").toLowerCase();
  if (name === "openai" || name === "openai-compatible") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new MalformedLlmOutputError(
        "OPENAI_API_KEY is not set. Use provider=deterministic or set a key. Core never silently falls back.",
      );
    }
    return new OpenAICompatibleProvider({
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.ACTIONMAN_MODEL ?? "gpt-4o-mini",
      timeoutMs: Number(process.env.ACTIONMAN_TIMEOUT_MS ?? 30_000),
      maxRetries: Number(process.env.ACTIONMAN_MAX_RETRIES ?? 0),
    });
  }
  return new DeterministicProvider(doc);
}

export class ActionExtractor {
  constructor(private readonly provider: LlmProvider) {}

  async extract(docInput: CanonicalDocument, timeoutMs = 30_000): Promise<ActionManifest> {
    const doc = ensureSourceHash(docInput);
    const text = canonicalText(doc);
    const raw = await this.provider.complete({
      system: EXTRACTOR_SYSTEM_PROMPT,
      user: buildUserPrompt(doc.id, doc.title, text),
      timeoutMs,
    });
    const { actions } = parseActionsPayload(raw);

    const manifest: ActionManifest = {
      schema_version: SCHEMA_VERSION,
      source: {
        id: doc.id,
        hash: doc.sourceHash,
        title: doc.title,
      },
      actions: actions.map((a, i) => ({
        ...a,
        id: a.id || `act_${String(i + 1).padStart(3, "0")}`,
        status: a.status ?? "proposed",
        inference: a.inference ?? "explicit",
        evidence: (a.evidence ?? []).map((e) => ({
          ...e,
          source_id: e.source_id || doc.id,
        })),
      })),
      receipt: {
        extraction: {
          provider: this.provider.id,
          model: this.provider.model,
          extractor_version: EXTRACTOR_VERSION,
          schema_version: SCHEMA_VERSION,
          created_at: new Date().toISOString(),
        },
      },
    };

    return validateActionManifest(manifest);
  }
}

export async function extractActions(
  doc: CanonicalDocument,
  options: ExtractOptions = {},
): Promise<ActionManifest> {
  const provider = options.provider ?? resolveDefaultProvider(doc);
  const extractor = new ActionExtractor(provider);
  return extractor.extract(doc, options.timeoutMs);
}
