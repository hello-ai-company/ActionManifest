# Compatibility & Versioning

Three version axes evolve independently. Never conflate them.

| Axis | Example | Governs |
| --- | --- | --- |
| **Manifest schema version** | `0.2.0` | The Action Manifest JSON contract (`schema_version` field) |
| **Package version** (npm, per package) | `0.1.0` | The TypeScript reference implementation's API |
| **Conformance suite version** | `0.1.0` | The official test vectors (`conformance/manifest.json`) |

## Current state (Phase 2.3)

| Component | Version | Notes |
| --- | --- | --- |
| All 10 npm packages (lockstep) | `0.1.0` — **unpublished**; first release `0.9.0-rc.1` | Lockstep/fixed versioning (ADR 0007) |
| Manifest schema | `0.1.0` + `0.2.0` (both frozen, sha256-pinned) | `0.2.0` is current; `0.1.0` still accepted by readers |
| CanonicalDocument schema | unversioned | additive-only evolution (integration boundary) |
| Conformance suite | `0.2.0` | 65 universal vectors + 4 reference-serialization goldens |
| Node.js | `>= 20` (9 packages + CLI); `>= 22` (`adapter-xberg` only) | developed/tested on Node 22 |
| `@xberg-io/xberg` | exactly `1.1.3` | exact pin (ADR 0007); optional package only |
| pnpm | `10.14.0` (`packageManager`) | workspace + pack/publish tooling |

## Stability & experimental markers (0.x line)

The whole line is `0.x` and **unpublished** until `0.9.0-rc.1`: no stability
promise beyond what the conformance suite pins. Within that line, markers are
applied in three places (package README + this document + JSDoc):

| Surface | Stability | Marking |
| --- | --- | --- |
| 9 core packages (schema, core, temporal, adapters, extractor, verifier, exporters, consumer, cli) | `0.x` — normal pre-1.0 policy (this document) | README "Known limitations"; no per-API marker |
| `@actionmanifest/adapter-xberg` Layer A — `mapXbergResultToCanonical` | **Stable structural mapper** (pure; no native binding, no network) — normal 0.x policy | README stability split; JSDoc stability note |
| `@actionmanifest/adapter-xberg` Layer B — `XbergAdapter` runtime bridge (`xberg-uri` / `xberg-bytes`, dynamic NAPI import) | **Experimental** — may change between 0.x minors; Node >= 22; live tests opt-in (`pnpm xberg:integration`, Node 22+) | README stability split; this table; JSDoc `@experimental` on `XbergAdapter` |

Default CI runs on **Node 20** (all packages except the Xberg bridge paths);
`pnpm xberg:integration` is the opt-in Node 22+ lane for the native runtime.

## Schema compatibility

- **Published schema versions are immutable.** `0.1.0` and `0.2.0` are frozen
  contracts, pinned by sha256 (`packages/schema/schemas/checksums.json`) and
  enforced in CI. A frozen schema MUST NOT change — not even for
  clarifications.
- **Breaking schema change → new `schema_version`.** Removing/renaming a
  field, tightening a type, or changing field semantics requires a new
  version directory (`schemas/v0.3/…`) and dispatch entry.
- **Additive change needs a versioning decision.** An optional additive field
  that does not affect interoperability semantics MAY ship as a minor schema
  version at maintainers' discretion; if it changes how any conformant
  reader interprets existing fields, it MUST be a new version. (Precedent:
  per-Action verification fields were additive but semantics-bearing →
  `0.2.0`.)
- **Unknown `schema_version` → reject.** Readers MUST fail closed.
- **Known older version → validate against its exact frozen schema.** Version
  dispatch is exact (`0.1.0` → v0.1 schema, which cannot carry v0.2-only
  fields), never "latest schema accepts all".
- The **CanonicalDocument schema is unversioned** and evolves additively
  (optional fields only; e.g. `mediaType` added in Phase 2). It is the
  integration boundary, not the manifest contract; semantic validation rules
  live in `docs/INTEGRATION-CONTRACT.md`.

## Package semver

While packages are `0.x.y`:

- Minor bumps MAY add APIs and MAY change behavior gated behind new options
  with safe defaults (e.g. the verified-only export policy).
- Breaking API changes SHOULD be avoided; if unavoidable they MUST be called
  out in CHANGELOG and release notes. No stability promise is made for
  `0.x` beyond what the conformance suite pins.
- The **public API surface is the package entry point only** (`exports` map).
  Deep imports are blocked and are not covered by semver.

## Conformance suite versioning

The suite version is governance-enforced: any change to normative
conformance contents (`conformance/vectors/**`, `conformance/schema/**`,
`conformance/manifest.json`) with an unchanged `suite_version` fails CI
(`pnpm governance:validate`). Reference-serialization goldens
(`conformance/vectors/reference-serialization/**`) are NOT normative — they
regress only the TypeScript implementation and never require a suite bump.

Bump levels (suite is `0.x`; semver-compatible intent, no stability promise
before 1.0):

- **Patch**: editorial/non-normative fixes only (descriptions, comments,
  formatting). MUST NOT change what passes or fails.
- **Minor**: new normative vectors, additive expectation fields, new optional
  profiles. Note honestly: a new normative vector CAN fail an implementation
  that was previously conformant — that is the point of adding it. Minor
  bumps signal "re-run the suite".
- **Major**: changed expected semantics on an existing vector, or changed
  required-profile semantics. Requires an ADR.

A conformant implementation declaration SHOULD name the suite version, e.g.
"conformant with actionmanifest-conformance 0.2.0".

## Universal conformance vs reference serialization

**Universal conformant** = all universal profiles (`schema`,
`canonical-document`, `evidence`, `trust`, `temporal`, `ics`) PASS **and**
critical false exported = 0. Universal ICS checks are semantic: property
order, PRODID, legal fold positions, and DTSTAMP lexical details are
implementation freedom (RFC 5545).

**Reference serialization** is a separate regression gate for the TypeScript
reference implementation (byte-exact goldens under a fixed clock). A
reference-serialization failure MUST NOT mark a third-party implementation
universally non-conformant. The TypeScript CI gates on both.

## Adapter compatibility

Adapters are versioned independently of the manifest schema
(`metadata.adapter_version`). An adapter MUST emit CanonicalDocuments that
pass `assertCanonicalDocument`. The Docling adapter accepts the documented
Docling JSON subset; upstream Docling format changes are handled by adapter
updates, never by Core changes.

## Deprecation policy

- Deprecated APIs are marked `@deprecated` and documented in CHANGELOG for at
  least one minor release before removal.
- Deprecated schema fields do not exist: schema evolution is by new versions,
  not in-place deprecation.
- Backward-compatible aliases (e.g. `mapDoclingFixture`) MAY be kept
  indefinitely when they cost nothing to maintain.

## Extension policy

- `ActionKind` / `Modality` accept `x-*` extension values. Producers SHOULD
  prefer known values; consumers MUST treat unknown `x-*` values as
  pass-through data (never as executable semantics).
- Closed enums (`ReviewStatus`, `TemporalType`, `ActorCertainty`,
  `Inference`) MUST NOT be extended by producers; new values require a new
  schema version.
- `metadata` objects are open extension points (`additionalProperties: true`)
  for adapter/producer-specific data; Core MUST NOT depend on them.
- ICS X-properties (`X-ACTIONMANIFEST-*`) are reserved for ActionManifest
  trust metadata.
