# API reference (entry points)

Light reference for the public entry points of each package. The normative
contract is [SPECIFICATION.md](SPECIFICATION.md) +
[INTEGRATION-CONTRACT.md](INTEGRATION-CONTRACT.md); the TypeScript types in
each package's shipped `.d.ts` are the detailed source of truth. Only the
`exports` map entry points are public API — deep imports are blocked and not
covered by semver.

Executable usage: [examples/library-quick-start.ts](examples/library-quick-start.ts)
and [examples/per-action-verification.ts](examples/per-action-verification.ts)
(CI-run).

## `@actionmanifest/schema`

Language-neutral JSON Schemas (immutable v0.1/v0.2) + TypeScript types.

| Export | Kind | Purpose |
| --- | --- | --- |
| `SCHEMA_VERSION` | const | Current manifest schema version (`"0.2.0"`) |
| `SUPPORTED_SCHEMA_VERSIONS` | const | All accepted versions (`["0.1.0", "0.2.0"]`) |
| `actionManifestSchemasByVersion` | const | version → parsed JSON Schema |
| `actionManifestSchemaV01` / `actionManifestSchemaV02` | const | Frozen schema objects |
| `canonicalDocumentSchema` | const | CanonicalDocument schema (unversioned, additive) |
| subpath `./schemas/v0.1/action-manifest.schema.json` | JSON | Raw schema (language-neutral consumers) |
| subpath `./schemas/v0.2/action-manifest.schema.json` | JSON | Raw schema |
| subpath `./schemas/canonical-document.schema.json` | JSON | Raw schema |
| `Action`, `ActionManifest`, `CanonicalDocument`, `Temporal`, `VerificationFlags`, … | types | Contract types |

## `@actionmanifest/core`

Canonical document model, hashing, validation, trust, errors. No I/O.

| Export | Purpose |
| --- | --- |
| `validateActionManifest(data)` | unknown → typed manifest; dispatches by `schema_version`; throws `SchemaValidationError` |
| `tryValidateActionManifest(data)` | non-throwing variant |
| `validateCanonicalDocument(data)` / `assertCanonicalDocument(data)` | schema + semantic checks; assert throws `InvalidDocumentError` |
| `checkCanonicalDocument(doc)` | non-throwing issue list (errors + warnings) |
| `ensureSourceHash(doc)` | set `sourceHash = sha256(canonicalText(doc))` |
| `canonicalText(doc)` / `sha256Hex(text)` / `normalizeForMatch(text)` / `sourceContainsQuote(source, quote)` | hashing/matching primitives |
| `evaluateActionTrust(action, flags?)` / `trustDispositionFor(reason)` | per-Action trust → ready / review_required / blocked |
| `manifestFatalReasons(flags)` | manifest-level fatal reasons |
| `locateEvidence(doc, evidence)` | quote → page/bbox/section/sourceReference |
| Error taxonomy | `ActionManifestError`, `SchemaValidationError`, `DocumentAdapterError` (+ `UnsupportedInputError`, `MalformedAdapterPayloadError`, `MissingSourceIdError`, `InvalidDocumentError`, `InvalidPageError`, `InvalidBoundingBoxError`, `MultipleDocumentsError`), `ExportError`, … |
| `EXTRACTOR_VERSION` | receipt constant |

## `@actionmanifest/adapters`

Document adapters: parse/normalize ONLY (never infer Actions).

| Export | Purpose |
| --- | --- |
| `PlainTextAdapter` | reference adapter: text/path → CanonicalDocument |
| `DoclingAdapter` | Docling JSON (`export_to_dict()`) → CanonicalDocument |
| `resolveAdapter(input)` / `getAdapter(id)` | built-in adapter resolution |
| `DocumentAdapter<I>` | the generic contract third-party adapters implement |
| `AdapterInput` | union of built-in input kinds (do not extend; define your own `I`) |

## `@actionmanifest/temporal`

Deterministic Japanese/English temporal + modality parsing. Unknown stays unknown.

| Export | Purpose |
| --- | --- |
| `parseTemporals(text, ctx?)` | all temporal mentions (exact/approximate/relative/range/unknown) |
| `primaryTemporal(text, ctx?)` | the dominant temporal, if any |
| `reiwaToGregorian(n)` / `heiseiToGregorian(n)` / `showaToGregorian(n)` | era conversion |
| `extractYearContext(text)` | year inference context |
| `isApproximateCue` / `isNegation` / `isCancellationContext` / `isReferenceContext` / `isPastCompletedContext` / `isCorrectionContext` / `correctionCueIndex` | linguistic cues |
| `detectModality(text)` / `detectKind(text)` | modality (required/optional/…) + action kind |

## `@actionmanifest/extractor`

CanonicalDocument → candidate manifest. The model is replaceable.

| Export | Purpose |
| --- | --- |
| `extractActions(doc, options?)` | one-shot deterministic extraction |
| `ActionExtractor` | class form; accepts any `LlmProvider` |
| `DeterministicProvider` | local, offline, no network (default) |
| `OpenAICompatibleProvider` | opt-in LLM (source leaves the machine) |
| `MockProvider` / `FixtureJsonProvider` | test providers |
| `extractDeterministically(doc)` / `splitSentences(text)` | deterministic pipeline pieces |
| `LlmProvider`, `LlmCompletionRequest`, `CandidateEnvelope`, `ExtractOptions` | provider contract types |

## `@actionmanifest/verifier`

Deterministic per-Action verification. No LLM.

| Export | Purpose |
| --- | --- |
| `verifyManifest(manifest, doc, options?)` | → `{ manifest, flags }` with per-Action results |
| `verifyAction(action, doc, source, manifest)` | single-Action checks |
| `verificationPassed(flags)` | aggregate pass |
| `actionVerificationPassed(result)` | per-Action pass |

## `@actionmanifest/consumer`

Reference consumer policy. Never executes anything.

| Export | Purpose |
| --- | --- |
| `classifyManifest(manifest)` | → ready / review_required / blocked counts + per-Action dispositions |
| `readyActions(manifest)` | the ready subset |
| `CONSUMABLE_STATUSES` | statuses a consumer may act on |

## `@actionmanifest/exporters`

Local file exporters. Core never writes to third-party apps.

| Export | Purpose |
| --- | --- |
| `exportJson(manifest, policy?)` | manifest JSON (verified-only by default) |
| `exportIcs(manifest, options?)` | RFC 5545 ICS; `options.now` injects the clock; throws `ExportError` on manifest-level fatal |
| `selectExportableActions(manifest, policy?)` | the trust-qualified subset |
| `actionUid(...)` | stable opaque UID derivation |
| `formatSummary(manifest)` / `formatVerification(...)` / `verificationVerdict(...)` | human-readable CLI formatting |

## `@actionmanifest/adapter-xberg` (optional, Node >= 22)

Xberg reference adapter. The native binding loads only via Layer B.

| Export | Purpose |
| --- | --- |
| `mapXbergResultToCanonical(payload, { sourceId })` | Layer A: pure mapping of a serialized `ExtractionResult`; no native code, no network |
| `XbergAdapter` | Layer B: runtime bridge (`xberg-uri` / `xberg-bytes` / `xberg-result`); remote URLs require `allowRemote: true` |
| `XbergAdapterInput` and friends | input types |

## `@actionmanifest/cli`

The `actionman` command. See [apps/cli/README.md](../apps/cli/README.md) for
the full command/flag/exit-code reference. The package entry point executes
the CLI on import — it is not a library.
