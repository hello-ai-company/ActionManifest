# Matoe compatibility verification — 2026-10-02

Base: `hello-ai-company/ActionManifest` main
`18c159c0bbb238b410c003cc8e60e7a8e013309f`.
Local branch: `fix/matoe-explicit-compatibility`. No remote writes.

Read `AGENTS.md`. The repository has no `.agents/skills`, and `/workspace/.agents`
is empty; no additional local skill instructions were available.

## Environment and initial failures

Node `v24.19.0`. Initial PATH resolved pnpm `11.19.0`, despite the repository's
exact `11.23.0` pin. Initial build/lint/typecheck/schema checks passed, but the
initial standard test run was **505/508**: deterministic-pack minimum, pack
dependency order stability, and a missing transient CLI conformance profile
schema. The latter coincided with parallel prepack/postpack asset staging.
No tests were deleted or relaxed.

Used pnpm `11.23.0`, including child processes spawned by tests. A local wrapper
is available at `/workspace/.cache/actionmanifest-bin/pnpm`, backed by the
existing `/workspace/.cache/corepack/v1/pnpm/11.23.0/bin/pnpm.cjs`.
The default home/cache paths were unavailable, so package-manager cache/data
were directed to writable task paths. The existing pnpm store is
`/workspace/.cache/pnpm-store`.

Dependency installation initially failed on unavailable home paths, then offline
metadata. Registry metadata reads resolved setup; no paid APIs were called.
Final `pnpm install --frozen-lockfile --ignore-scripts --store-dir /workspace/.cache/pnpm-store`
passed, including the 219-entry supply-chain policy check, with existing cached
packages reused. Temporary unrelated lockfile metadata changes were removed.
The committed lockfile difference is only the new CLI → consumer workspace link.

## Final measured results

| Command | Result |
| --- | --- |
| `pnpm build` | exit 0; all packages and CLI built |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0; includes reference consumer |
| `pnpm schema:validate` | exit 0; both frozen schema checksums preserved |
| `pnpm docs:check` | exit 0 |
| `pnpm test` | exit 0; 48 files, **556/556** tests |
| `pnpm test --no-file-parallelism` | exit 0; **556/556** tests |
| `pnpm integration:test` | exit 0; 6 files, **22/22** tests through built exports |
| `pnpm conformance` | exit 0; **65/65**, critical false exported **0** |
| `pnpm conformance:reference` | exit 0; universal **65/65** + reference serialization **4/4** |
| `pnpm xberg:integration` | exit 0; native runtime **2/2** |
| `git diff --check` | exit 0 |

Test increase: 44 Matoe contract tests + 4 prototype-version dispatch tests
over the existing 508 standard tests; 2 built-package/CLI tests over the existing
20 integration tests. No fixture suite version or frozen schema was changed.
Full Release Check was not run; this evidence is not a release-readiness claim.

For these checks, pnpm was pinned via PATH. The writable package-manager settings
were `XDG_DATA_HOME=/tmp/actionmanifest-data`,
`XDG_CACHE_HOME=/tmp/actionmanifest-cache`,
`npm_config_store_dir=/workspace/.cache/pnpm-store`. These contain no credentials.
Non-secret command logs remain under `/tmp/actionmanifest-evidence` in this session.

## Coverage and safety judgment

- Golden 0.2 input → frozen 0.1 wire, complete original/audit retention, no input
  mutation, no approval-state reset, and equivalent consumer trust counts.
- Unknown/prototype version, unknown fields/null, missing/mismatched hash,
  missing/unknown/inconsistent extraction provenance, empty/wrong Evidence,
  duplicate identities, fatal/mixed/contradictory/incomplete verification,
  hidden warnings, rich temporal forms, and accepted/exported/rejected status
  all fail with a reason.
- Both complete clean verification and proposed unverified extraction are
  explicit paths. Unverified output retains proposed status and requires review.
- Built adapter → deterministic extractor → verifier → compatibility bundle →
  v0.1 validation succeeds; CLI golden output, source mismatch refusal, and
  existing-output refusal succeed.
- Separately ran the documented deterministic CLI extract + prepare-matoe flow:
  one action, unchanged source actions, and complete original receipt retained.
- Security finding reproduced before the fix: schema versions `constructor` and
  `toString` were accepted via inherited properties; `__proto__` raised TypeError.
  `Object.hasOwn` now restricts dispatch to registered schema versions, with
  regression tests. No new version is implicitly permitted.

## External boundary

Read-only GitHub access to Otayori succeeded. Pinned reference commit:
`696b2ebb21e28dbf6ba56cfce68c29f6df1480b9`. Contract, AnalysisService, rejection
tests, Python server, and Release URL setting were rechecked. The standalone
ActionManifestBridge.swift lookup returned 404; its implementation is in
ActionManifestContract.swift. Source links and setup instructions are in
[MATOE-COMPATIBILITY.md](../../docs/MATOE-COMPATIBILITY.md).

No Swift toolchain/iOS runtime is available here. Swift decode, UI mapping,
HTTP service integration, audit storage, active backend configuration, and
production connectivity remain unverified. No other repository was edited.
No credentials, permission changes, DB writes, deploys, production operations,
payments, message sends, push, PR, or merge were performed.

Next minimal step: in an independently authorized Matoe task, feed the golden
wire and exact OCR source to the existing Swift bridge test, assert due date and
review state plus refusal cases, then exercise a local free HTTP response stub.
The current Python server needs an explicitly selected compatibility response
path/backend integration with audit retention; no Swift version-gate weakening
is necessary for this profile.
