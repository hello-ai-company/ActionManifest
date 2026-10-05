# Matoe proposal recovery contract

This contract covers local proposal analysis. The CLI has no payment, messaging,
approval persistence or durable execution queue. Matoe owns HTTP/subprocess
control, request correlation, presentation, storage and any separate executor.
The existing [0.1 profile](MATOE-COMPATIBILITY.md) and explicit
[0.2 route](MATOE-SERVER-V02.md) keep their wire formats and validation rules.

## Stop, retry and correlate

| Outcome | Required consuming behavior |
| --- | --- |
| Exit 1 / fixed request error | No manifest or partial success to adopt. Keep the document available for correction; do not retry unchanged invalid input |
| Agent exit 2 with ok=true | Analysis completed with blocked candidates. Preserve full results and reasons; no automatic adoption or unchanged-evidence retry |
| Matoe exit 0 / HTTP 2xx | Validate the entire 0.2 response. Inspect every per-action result; failed candidates remain blocked and passed candidates still need human review |
| Timeout, cancellation, worker crash, malformed/truncated response or output budget exceeded | Terminate the worker, drain/close its pipes and discard all partial output. No legacy or paid-provider fallback. Return a fixed unavailable/error result |
| Unexpected pipeline failure | A caller may retry within its explicit attempt/time budget after checking runtime availability. retryable=true never grants execution or unlimited retries |
| Late response for a canceled/superseded request | Discard it. A valid receipt for an old request is not the result for the current document revision |

Use argv arrays with configured absolute Node/CLI paths and one bounded JSON
request per fresh worker. Bound concurrent workers, wall time and stdout/stderr
in the wrapper. Never interpolate OCR into shell commands or log request bodies,
quotes, IDs or caught exception text. These wrapper controls remain Matoe-owned;
this repo does not implement or verify a live Python service.

Before adopting a response, match its source.id and SHA-256 to the **exact request
OCR** and the pending request/document revision. Do not replace the hash with the
original file hash. A network success or nonempty stdout alone is insufficient.
The agent additionally returns input_fingerprint for correlation to its complete
JSON request. It is bound before asynchronous extraction yields, not recomputed
from a caller's later-mutated object. Received verification is never an approval;
the agent verify operation recalculates it against the supplied source.

## Duplicate analysis and approval

Repeating the same input produces the same proposal identities and agent input
fingerprint; receipt timestamps can change. This makes request/result correlation
possible, but does not persist deduplication. The stateless CLI creates no product
items and grants no execution authority on either the first call or a retry.

Matoe must reconcile duplicate responses with the same document revision and
proposal identity instead of appending duplicate adopted items. Include source
hash and the analyzer/schema/profile version in product revision tracking. Do
not use the fingerprint as an execution idempotency key or carry acceptance
across changed OCR, changed material Action fields or a replaced verifier result.
Approval and execution records, if a product has them, require their own durable
identity and transaction rules outside ActionManifest.

For a blocked candidate, human approval alone cannot promote its failed receipt.
Correct the candidate/source and reverify, or create a separate explicit manual
item. Keep the original failure and its relationship to the correction visible.
Never import accepted/exported/rejected into the agent proposal endpoint; the
existing lifecycle gate refuses those states.

## Completion evidence and remaining checks

`integration/reference-consumer/test/proposal-recovery.test.ts` executes the
actual built CLI from an empty foreign directory under an OpenAI-selected
environment with no API key. It checks repeated proposals, invalid → blocked →
valid recovery, process termination just after spawn with unfinished stdin followed by a fresh
request, and concurrent Matoe workers with distinct identities/hashes/quotes.
No files are created in that directory. Shared legacy/golden/mixed/negative
contract tests remain in the standard and integration suites. Unit tests also
reproduce in-process input mutation and bind the agent fingerprint and Matoe
response to the original canonical input.

These synthetic local results do not establish HTTP retry/timeout behavior,
Swift persistence deduplication, late-response handling, physical iPhone behavior,
real-document accuracy, live backend availability or an external agent connection.
The unfinished-stdin termination test confirms no partial receipt and fresh-process
recovery. It does not establish that the CLI entered stdin reading, or simulate a
crash during extraction or durable execution.

The next Matoe-owned acceptance checks are: run this exact built artifact behind
the explicit route; replay timeout/cancellation/truncated/duplicate/late responses;
verify source-revision correlation and that failed adoption stays disabled; check
that all roles, conditions, notes, temporal branches/timezones, evidence and issue
messages survive rendering/storage; then exercise the configured app on device.
Keep synthetic fixtures until real documents and any external transmission are
separately authorized. No npm publication or deployment is implied by local PASS.
