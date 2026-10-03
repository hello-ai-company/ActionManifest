# Matoe explicit v0.2 offline handoff

Branch: `fix/matoe-explicit-compatibility`; published comparison base:
`18c159c0bbb238b410c003cc8e60e7a8e013309f`; previous local checkpoint: `607791a`.
Node 24.19.0 / cached pnpm 11.23.0; 2026-10-03 UTC.

Added actual deterministic extract → verify → full frozen-v0.2 contract API/CLI.
CLI accepts only sourceId/ocrText via bounded UTF-8 stdin and never chooses a
paid provider from environment. No invented PDF page geometry. Source identity,
exact OCR hash, known provenance, ingress lifecycle, evidence quotes, complete
per-action verification and aggregate consistency fail closed. Mixed valid
receipts retain failed Actions; downstream must BLOCK them. All passed Actions
still require Matoe human review. Entire temporal/actor/conditions/notes/evidence
and receipt payload survives unchanged. Existing generic v0.2 and v0.1 profile
are preserved; frozen schemas are unchanged.

Measured final checks: build PASS; lint PASS; typecheck PASS;
schema:validate PASS; standard tests **653/653** (54 files);
integration **37/37** (8 files); docs:check PASS; conformance **65/65**;
reference serialization **4/4**. Initial build exposed TypeScript control-flow
narrowing around a never-returning helper; corrected with a function declaration
before these final checks. No tests were removed.

Synthetic golden comes from the built actual CLI, with only two receipt timestamps
fixed for comparison. Mixed fixture comes from the real verifier after changing
one deadline; it has 3 passed and 1 failed Action. Four shared negative fixtures
exercise hash/version/approval/summary refusal. Integration forces paid-provider
environment selection with no key and an unusable endpoint while verifying the
explicit deterministic path still succeeds. Unexpected errors do not echo OCR.

Offline bundle generator includes compiled runtime dependency closure, scoped
committed source, synthetic fixtures, contract, per-file SHA-256 manifest and
standalone verification/smoke scripts. Bundle generation refuses dirty worktrees,
symlinks, credential/config paths and credential-shaped values. It runs actual
offline CLI/golden, mixed-blocked and negative checks in its isolated directory.
Artifact SHA-256 and Library identity are reported after actual creation; this
file does not claim an artifact exists before that operation succeeds.

No Otayori edits, remote push/PR/merge, npm publication, external paid API,
credential additions, deployment, DB or production operations. User separately
authorized saving this synthetic-code artifact to their personal Library and
the Matoe environment reading it. No public transfer URL is created.

Unverified: actual Python route integration, new Swift v0.2 parser, iOS field
presentation and approval persistence, real backend/Release URL, on-device OCR,
CloudKit behavior and live end-to-end. Old Python legacy response can be decoded
by the existing bridge's missing-schema-version branch; it does not establish
ActionManifest compatibility. Next step is recipient materialization/hash check,
actual-runtime Python route tests, then Swift shared positive/negative fixtures.
