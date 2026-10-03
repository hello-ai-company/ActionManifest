# Safe local agent interface

Branch: `fix/matoe-explicit-compatibility`; incremental base:
`7453b33ab0779831351ae2423a42e5720c661328`.
Node 24.19.0, cached pnpm 11.23.0, 2026-10-03 UTC.

Initial findings: extractor/verifier/consumer SDKs already implement the pipeline;
the ordinary CLI already supports JSON for some successes, but errors and input
budgets are inconsistent. No existing MCP server was found. Kept those primitives
and added one bounded CLI facade plus an additive typed public `cli/agent` export;
no new extraction/verifier implementation, server or executor.

Operations: deterministic offline extract and fresh verify of proposed/verified
0.2 candidates. Exact source identity/hash, matching known extraction provenance,
unique Action IDs, frozen schema, lifecycle and input budgets fail closed. Forged
incoming verification is recomputed. Failed Actions remain present and blocked;
full temporal/role/conditions/evidence/notes/receipt remain available. Every result
states no execution authority, required human approval, and no issuer authentication.
The input fingerprint is stable across key ordering, not an execution dedupe key.
Fixed JSON errors omit input/exception text and mark only unexpected pipeline
failure retryable. Generic existing 0.2 behavior and Matoe profiles are preserved.

Measured checks: build, lint, typecheck, schema:validate and docs:check PASS;
standard **680/680** (55 files, 27 new agent tests); integration **44/44**
(9 files, 7 new agent tests); conformance **65/65**, critical false exported 0;
reference serialization **4/4**. pack:check PASS: 10 packed artifacts, standalone
library type/runtime checks, actual foreign-directory CLI installation, new public
agent subpath import without Commander side effects, actual JSON bin execution.
Pack/check/install operations are local verification, not npm publication.

Failures corrected before final pass: Vitest table arguments initially failed
integration typecheck; changed argument rows to named objects. Initial packed CLI
installation failed on offline metadata after its smoke fixture selected obsolete
pnpm 10.14.0. Fixture now reads the repository's authoritative packageManager;
final installation passed with pnpm 11.23.0. No tests were removed.

Self-review: received accepted/exported/rejected states cannot fabricate approval;
verified/ready never means approved. Human review cannot unblock failed verification.
Incoming receipt does not prove issuer identity; exact supplied source is still
caller-provided. No normalization or fake page geometry. All success/mixed results
are unfiltered. Fixed failure messages do not echo source data; successful evidence
payloads must be handled privately. Plain JSON-compatible in-process data is the
documented boundary; CLI additionally checks transport bytes/UTF-8. Public stream
types use Uint8Array, avoiding a Buffer type dependency in the new declaration.
Callers own concurrency, wall time, output bounds, approval and executor idempotency.

No Otayori edits, external-agent connection, auth tokens, paid API calls, new
permissions, public server, deployment, DB/production operations, push/PR/merge or
npm publication. Earlier Library handoff still identifies commit 7453b33; it has
not been replaced with this newer agent addition.

Usage: docs/AGENT-USAGE.md; synthetic input: examples/agent-extract.json.
Next minimal step: use the local CLI/subpath from a caller-owned agent tool and
run the shared negative fixtures. Actual external agent integration, product
approval UX and live E2E remain unverified. These checks do not establish universal
competitive superiority or execute any pay/reply proposal.
