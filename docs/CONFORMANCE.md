# Conformance

The ActionManifest Conformance Suite decides whether **any** implementation —
TypeScript, Python, Rust, Go — correctly implements the ActionManifest
contract.

> **Benchmark ≠ Conformance.** The benchmark (`benchmark/fixtures`, 74
> synthetic documents, 40 adversarial) measures *semantic extraction quality*
> of the reference extractor. The conformance suite measures *protocol /
> contract correctness* of any implementation. They are separate gates; the
> adversarial fixtures are not copied into conformance vectors.

## Definitions

- **Official conformance** is defined by the normative documents
  (SPECIFICATION.md, INTEGRATION-CONTRACT.md, STANDARDS.md) **plus the vector
  meta-schemas (`conformance/schema/`)** plus the vectors
  (`conformance/vectors/`). TypeScript interfaces are NOT normative.
- **Universal conformance** is semantic and implementation-independent. It
  never requires byte-identical output with the reference implementation.
- **Reference serialization** (`reference-serialization` profile) is a
  TypeScript-only regression gate: byte-exact `.ics` goldens under a fixed
  clock. It is never part of universal conformance; a failure there does not
  make a third-party implementation non-conformant.
- **Implementations MAY create their own runner.** The reference runner only
  consumes public package entry points; it requires no private/internal
  utility.
- **Vectors are normative.** They are hand-written from the specification.
  Never generate `expected` from implementation output. If the reference
  implementation fails a vector, the implementation is wrong.
- **Normative test data is code.** Every vector is validated against its
  profile meta-schema (Draft 2020-12, `additionalProperties: false`) before
  execution. A malformed vector — typo'd field, unknown profile, missing
  required key — is a runner/config error (exit 2), never a silent pass.

## Suite versioning

The suite has its own version (`conformance/manifest.json` → `suite_version`,
currently `0.2.0`), independent of the manifest schema versions and npm
package versions. Changing normative contents without bumping the version
fails CI (`pnpm governance:validate`). See COMPATIBILITY.md.

## Vector format

Vectors are plain JSON (RFC 8259), one file per vector:

```json
{
  "id": "failed-verified-001",
  "profile": "trust",
  "description": "status=verified but per-action receipt failed → blocked",
  "input": { "...": "profile-specific" },
  "expected": { "...": "profile-specific" }
}
```

### Profiles

| Profile | Input | Expected |
| --- | --- | --- |
| `schema` | a manifest JSON value | `valid` (+ optional `error_code`) |
| `canonical-document` | a CanonicalDocument JSON value | `valid`, `errors[]`, `warnings[]` (issue codes) |
| `evidence` | `{ manifest, document }` | per-action `evidence_supported` / `page_refs_valid` / `passed` |
| `trust` | `{ action, verification \| null }` | `ready`, `reason`, `disposition`, `exportable_default` |
| `temporal` | `{ kind, temporal }` | `artifact` (VEVENT/VTODO/null), `executable_date` (YYYYMMDD/null), optional `comment_includes` |
| `ics` (universal) | `{ manifest, options: { now, include? } }` | `components` (semantic component/property comparison), `contains`, `not_contains`, `artifact_counts`, `max_octets_per_line`, `crlf_only`, `uid_pattern`, `uid_not_contains`, or `export_error`. `golden` is FORBIDDEN here. |
| `reference-serialization` | same as `ics` | `golden` (byte-exact file, required) plus any semantic checks |

Universal `ics` comparison is semantic: `components` matches component types
and property sets order-independently (property order, PRODID, fold position,
DTSTAMP lexical details are not normative). Byte-exact goldens live only in
`reference-serialization` (`vectors/reference-serialization/golden/`), used
with an injected `options.now` clock.

## Reference runner

```bash
pnpm conformance              # full suite
pnpm conformance:smoke        # safety-critical profiles only (trust, ics)
pnpm actionman conformance --json
```

Example output:

```text
ActionManifest Conformance (suite 0.1.0)
trust                 11/11 PASS
temporal              12/12 PASS
ics                   12/12 PASS
canonical-document    13/13 PASS
evidence               6/6 PASS
schema                11/11 PASS
TOTAL                 65/65 PASS
Critical false exported: 0 (MUST be 0)
CONFORMANT
```

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | conformant — all vectors pass and critical false exported = 0 |
| 1 | conformance failure — at least one vector failed |
| 2 | runner/config error — suite missing, malformed vector, I/O error |

### Machine-readable report

`actionman conformance --json`:

```json
{
  "suite_version": "0.1.0",
  "result": "conformant",
  "profiles": { "trust": { "passed": 11, "total": 11 } },
  "totals": { "passed": 65, "total": 65 },
  "critical_false_exported": 0,
  "failures": []
}
```

## Safety assertion: critical false exported = 0

Beyond per-vector pass/fail, the runner enforces a global safety invariant:
an Action whose trust disposition is `blocked` or `review_required` must
never reach the default executable export. Any occurrence is a
**critical false export** and fails the suite even if every vector passes
individually.

## Writing new vectors

1. Write the vector from the specification, not from observed output.
2. Keep it language-neutral (JSON only; no code references).
3. Prefer the smallest input that exercises the rule.
4. For ICS goldens: generate the candidate output, review it line by line
   (folding, escaping, UID, DTSTAMP), then freeze it as the golden file.
5. Bump `suite_version` (minor for additive vectors, major for changed
   expectations).
