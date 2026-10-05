# Explicit offline Matoe server route (v0.2)

This is a local integration contract, not a live-service claim. Preserve the
Python/OpenAI `POST /v1/analysis` and old v0.1 bridge. The new route is explicitly
selected `POST /v1/analysis/actionmanifest`; failure never falls back to legacy
LLM analysis. Production endpoint activation is outside this work.

## Wire and execution

The HTTP route takes Matoe's existing AnalysisRequest. Validate its documentID
and OCR text, then forward only this object to the real CLI on stdin:

```json
{"sourceId":"11111111-1111-4111-8111-111111111111","ocrText":"2026年10月15日までに参加票を提出してください。"}
```

Run the argv array `node <absolute CLI path>/dist/index.js analyze-matoe --stdin-json`.
Use separately configured installed Node and CLI paths, never npx, network
installation, credentials, an interpolated shell command or an OCR temp file.
New configuration defaults OFF. Missing actual runtime is MATOE_NOT_CONFIGURED,
not permission to substitute an imitated implementation. Python must bound
concurrency, runtime, request bytes and child stdout/stderr before returning them.

CLI stdin: exactly two fields, valid UTF-8 JSON/well-formed Unicode; nonblank
sourceId <=256 scalars; nonblank OCR <=60,000 scalars / 240,000 UTF-8 bytes;
total request <=1 MiB. Source ID is request.documentID exactly. The source.hash
is SHA-256 of the exact **redacted request.ocrText**, with no trimming, newline
change or Unicode normalization. Original-file Matoe contentHash is a different
identifier and must not be used for manifest.source.hash.

The real pipeline is text-only CanonicalDocument → explicit DeterministicProvider
→ ActionExtractor → verifyManifest → prepareMatoeV02Manifest. No environment
variable selects a paid provider. referenceDate/child identity do not invent a
missing year or actor. Since this request carries no verified geometry, no page 1,
bbox or locator is invented from flattened text or `[ページ 2]` markers. Local
Matoe OCR layout can resolve a quote anchor only when it actually matches.

Success stdout/HTTP 2xx body is the **full frozen 0.2 manifest itself**:
`{schema_version, source, actions, receipt}`. No outer ok/items/profile/audit/bundle.
No Action or field is filtered; extraction/provenance version remains 0.2. The
wire is already the original, so no downgrade audit is needed. Product retention
is still Matoe's responsibility. The existing prepare-matoe v0.1 path is separate.

## Strict acceptance and review

Public optional API: `prepareMatoeV02Manifest(input, canonicalSourceText, expectedSourceId)`
in `@actionmanifest/consumer`. Its restrictions do not change generic APIs.

- Frozen 0.2 validation; unknown versions/keys, null and malformed Unicode refused.
- Exact source ID/hash; nonblank known matching extraction provenance and strict
  extraction/verification timestamps; complete nonfatal verification required.
- Unique Actions and exactly one result per Action. All aggregate booleans,
  negation, passed/counts must equal the individual results.
- Per-action issues must identify the Action and appear in aggregate issues;
  scoped aggregate issues must appear in their Action. Blank/unknown identity,
  inconsistency and unattributed errors are refused.
- All Evidence must resolve to the source. A failed temporal/actor/modality
  candidate can be kept; fabricated/cross-source quotes are refused entirely.
- Only proposed/verified input. Accepted/rejected/exported are never reset;
  a failed result cannot be marked verified.
- This guard checks receipt integrity, not cryptographic issuer authenticity,
  and does not rerun the full verifier. The server must use the actual owned
  extraction/verifier against this request, not accept arbitrary claimed receipts.

**Valid mixed receipts return 2xx, but each failed Action is BLOCKED.** Preserve
its fields/result/error reasons and prohibit adoption, schedule creation and
execution. `needsUserConfirmation=true` alone is insufficient if the UI still
allows adopting the failed candidate. Unrelated passed Actions keep their results.
Initial v0.2 intake requires human review even for verified Actions: verified is
not approval. A correction can create a new manual item or verified analysis,
never silently promote the old failed receipt. Swift's new route must reject
missing version/old items responses rather than fall back to legacy decoding.

Preserve full Action/Receipt information in domain/presentation. New warning
codes are visible review reasons, never success evidence. Global warnings and
zero Actions remain visible, not an assertion that nothing needs attention.

| Information | Required presentation |
| --- | --- |
| actor.text/role | Show the stated actor; guardian/applicant is not a concrete family member ID |
| conditions/notes | Show every eligibility, exemption and note; conditional required is not universally required |
| approximate/unknown/range/conditional/alternatives | Keep type/raw_text/precision/certainty/every branch; never fabricate a day or collapse to a main date |
| timezone/datetime/civil date | Keep zone/offset/date-only meaning; no silent device-zone substitution. Unresolved scheduling is review-only |
| Evidence | Keep every quote/locator; missing anchor never justifies fake geometry or dropping a quote |
| verification | Keep flags/results/issues; distinguish blocked from review and display code/message/severity and association |

## Error protocol

CLI failure: exit 1, empty stdout, one fixed JSON error on stderr. Python returns
the fixed protocol, not caught exception text. Never log OCR, IDs, versions,
paths, environment values or request bodies as diagnostics.

```json
{"error":{"code":"MATOE_V02_CONTRACT_BLOCKED","message":"Analysis cannot satisfy the v0.2 consumer contract"}}
```

| code | Fixed message | HTTP |
| --- | --- | --- |
| MATOE_REQUEST_INVALID | Invalid analysis request | 400 |
| MATOE_INPUT_TOO_LARGE | Analysis request exceeds the input budget | 413 |
| MATOE_V02_CONTRACT_BLOCKED | Analysis cannot satisfy the v0.2 consumer contract | 422 |
| MATOE_NOT_CONFIGURED (Python) | ActionManifest runtime is not configured | 503 |
| MATOE_PIPELINE_FAILED | Analysis pipeline failed | 500 |

A wrapper timeout/unavailable worker may be a fixed 503 error and never triggers
paid retry/fallback. Successful output contains quotes and is application data,
not a diagnostic. 2xx means contract validity, not all-Action success or approval.
Unsupported analysis arguments use the same fixed MATOE_REQUEST_INVALID JSON
on stderr, empty stdout and exit 1; argument values are not echoed. Explicit
standalone `--help` / `-h` remains human help, not a server request. A server
request accepts exactly `analyze-matoe --stdin-json`; mixing help/version/unknown
arguments into that request is refused before the ordinary argument parser.

Product-side cancellation, duplicate response and retry requirements are in the
[recovery contract](MATOE-RECOVERY.md). These do not add an executor or durable
state to the stateless CLI.

## Shared synthetic fixtures

`packages/consumer/fixtures/matoe-v02/request.json` pairs with source.txt, including
its final newline. Source ID: `11111111-1111-4111-8111-111111111111`; hash:
`aad85edebe16aa196e6e2fa0ba649f5700d71ae546c956f3a8f11233b1407f86`.

- golden.json: real offline CLI output. Only receipt timestamps fixed to
  `2026-10-03T00:00:00.000Z`. Guardian signature/submission, applicant-only reply,
  rain alternative with two quotes, approximate November with no fabricated day.
- mixed.json: first declared date deliberately changed to 10/16, then **actual
  verifier rerun**. One proposed/failed TEMPORAL_UNSUPPORTED, three verified.
  Must display blocked separately and disable its adoption.
- negative-hash/version/approved/summary.json: golden mutations, all refused.
  Additional negative receipt/identity/Unicode cases are unit-tested.

These are synthetic code-contract evidence, not real documents or Swift/HTTP
success. The old 0.1 positive golden and negative tests remain unchanged.

## Offline transfer

After build/checks/commit on a clean checkout, run
`node scripts/matoe-offline-bundle.mjs /tmp/actionmanifest-matoe-v02.tar.gz`.
The script copies actual built packages and installed runtime dependencies,
licenses, scoped source/fixtures/docs, commit/base metadata and file hashes.
It does not install/upload/publish; Node itself is not bundled. Other CLI modes
requiring benchmark/conformance fixture assets are outside this minimal bundle.

Receiver: verify archive SHA before extracting into a new directory, run
`node verify-bundle.mjs` and `node smoke.mjs` there, then configure the Python
runner with that directory's `node_modules/@actionmanifest/cli/dist/index.js`.
No npm/pnpm/network install is needed. Use only the authorized private Library
transfer, not push/public URLs. A local path here is not accessible to the other
agent. Do not claim integration success until the receiver runs these actual
packages and real Python/Swift boundaries; fixtures or imitation are insufficient.
