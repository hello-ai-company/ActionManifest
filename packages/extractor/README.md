# @actionmanifest/extractor

CanonicalDocument → candidate Action Manifest. The model is **replaceable**:
a provider interface with a fully local deterministic default and an opt-in
OpenAI-compatible LLM provider.

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`.

```bash
npm install @actionmanifest/extractor  # once published
```

Requires Node.js >= 20.

## Usage

```ts
import { extractActions, ActionExtractor, DeterministicProvider } from "@actionmanifest/extractor";

// Deterministic (default): offline, no API keys.
const candidate = await extractActions(doc);

// LLM (opt-in): source text leaves the machine toward OPENAI_BASE_URL.
import { OpenAICompatibleProvider } from "@actionmanifest/extractor";
const extractor = new ActionExtractor(
  new OpenAICompatibleProvider({ apiKey: process.env.OPENAI_API_KEY! }),
);
const llmCandidate = await extractor.extract(doc);
```

## Key exports

- `extractActions(doc)`, `ActionExtractor`, `extractDeterministically`
- Providers: `DeterministicProvider` (default), `OpenAICompatibleProvider`
  (opt-in), `MockProvider` / `FixtureJsonProvider` (tests)
- Contract types: `LlmProvider`, `LlmCompletionRequest`, `CandidateEnvelope`

Extraction is **not** execution: output is a candidate manifest for the
verifier, never an action performed.

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `packages/extractor`)
- Specification: [docs/SPECIFICATION.md](../../docs/SPECIFICATION.md)

Apache-2.0.
