# Local agent interface

This unpublished addition reuses the existing extractor, verifier and consumer
policy. There is no MCP/public server, external-agent connection or new executor.
Default generic schema 0.2.0 and existing CLI commands are unchanged. Matoe's
separate wire profile is documented in MATOE-SERVER-V02.md.

## Allowed operations

| Operation | Behavior | Authority |
| --- | --- | --- |
| `extract` | Exact text → deterministic proposals → verification → classification | No network, writes, sending or payment |
| `verify` | Frozen 0.2 candidate → fresh verification against exact supplied text | Incoming verification is replaced; no approval imported |
| Existing SDK `validateActionManifest` | Frozen schema validation | Shape/version only; not semantic verification |
| Existing SDK `classifyManifest` | Classify a receipt already obtained from a trusted pipeline | Does not authenticate issuer or recheck original text |

Use one JSON request per process. Local Node is already installed; no network
installation is required for a built checkout:

```sh
node apps/cli/dist/index.js agent --stdin-json < examples/agent-extract.json
```

The example is synthetic. Required request fields:

```json
{"protocol_version":"1","operation":"extract","source":{"id":"synthetic","text":"2026年10月15日までに参加票を提出してください。"}}
```

For `verify`, add `manifest` containing the entire unfiltered 0.2 candidate.
source.id/hash must match; hash is SHA-256 of exact source.text UTF-8. No trimming,
Unicode normalization or original-file hash substitution. Known nonblank
extraction provider/model/version and matching schema_version are required;
self-reported provenance is not cryptographic issuer authentication. Only
proposed/verified ingress states are allowed. Accepted/exported/rejected belong
to the consuming application's approval lifecycle, not this proposal interface.
Unknown fields, protocol versions, schemas, provider/execution options and
source identities are refused. Plain text supplies no page/bbox proof.

Success is one JSON object on stdout: protocol_version, ok=true, operation,
input_fingerprint, complete manifest, classification (counts/actions/reasons),
authority. All actions/roles/conditions/notes/uncertain dates/alternatives/evidence
and receipts remain available; no verified-only filtering. The verifier replaces
the supplied verification receipt and blocks tampered or unsupported evidence.
`ok=true` means analysis completed, not that every Action passed.

| Exit | Meaning |
| --- | --- |
| 0 | Analysis completed with no blocked Actions; review may still be required |
| 2 | Analysis completed; blocked Actions or manifest fatal present; inspect full result |
| 1 | Request/pipeline failure; JSON error on stdout; no partial success payload |

Failure is `{protocol_version:"1",ok:false,error:{code,message,retryable},authority}`
with fixed diagnostics that do not echo input, paths or caught exception text.
Codes: AGENT_REQUEST_INVALID, AGENT_INPUT_TOO_LARGE, AGENT_SCHEMA_INVALID,
AGENT_SOURCE_MISMATCH, AGENT_PROVENANCE_INVALID, AGENT_LIFECYCLE_INVALID,
AGENT_PIPELINE_FAILED. Only unexpected pipeline failures are retryable; a caller
may make a bounded retry after checking its runtime. Do not retry unchanged
invalid/oversized inputs or blocked evidence. No paid-provider fallback exists,
including when environment selects OpenAI. Ordinary CLI --help is human help.

Limits: 1 MiB total UTF-8 request, 60,000 text scalars / 240,000 text UTF-8 bytes,
256 source-ID scalars, 256 Actions, depth 24. Malformed UTF-8/lone Unicode
surrogates are rejected. Callers bound subprocess concurrency, wall time and
output size separately. Payloads contain source quotes; handle them as private
data rather than logging full results by default.

## Typed in-process access and approval

The same facade is available as the additive `@actionmanifest/cli/agent` export
in this local build. It does not parse process.argv on import:

```ts
import { runAgentRequest, agentFailure, type AgentRequest } from "@actionmanifest/cli/agent";
const request: AgentRequest = {
  protocol_version: "1", operation: "extract",
  source: { id: "synthetic", text: "2026年10月15日までに参加票を提出してください。" },
};
try { const result = await runAgentRequest(request); /* inspect full result */ }
catch (error) { const failure = agentFailure(error); /* inspect code/retryable */ }
```

In-process callers supply plain JSON-compatible data; CLI additionally enforces
wire-byte/UTF-8 limits before JSON parsing. Existing SDK primitives remain usable
directly when an application owns its trust boundary.

`verified` means source checks passed. `ready` means consumer policy allows
consumption. Neither proves human approval. Authority always explicitly says
execution_allowed=false, human_approval_required=true, issuer_authenticated=false.
This facade cannot grant execution authority; even caller-asserted accepted state
is rejected. The consuming app authenticates the source, presents all material
fields and warnings, records explicit approval, and controls any separate executor.
Human approval alone cannot unblock failed verification: correct the candidate or
source and rerun verification first.
Pay/reply Actions are proposals, never actual payments/messages.

Operations have no external side effects and can be repeated. input_fingerprint
is SHA-256 of the exact JSON values with object keys sorted (array order retained).
It is stable for identical requests, not an executor idempotency key or proof of
issuer identity. Receipt timestamps may differ between repeats. Applications own
deduplication, approval persistence and execution idempotency separately.

Offline tests cover the real built CLI plus malformed/oversized/unknown-version
inputs, forged verification/evidence, source mismatch and lifecycle refusal.
Actual external-agent integration, deployment and product approval UI remain
unverified. This interface is not yet an npm release.
