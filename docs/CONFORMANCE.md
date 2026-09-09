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

- **Official conformance** is defined by the vectors under
  `conformance/vectors/` plus the normative documents (SPECIFICATION.md,
  INTEGRATION-CONTRACT.md, STANDARDS.md). It is NOT defined by TypeScript
  internal functions.
- **Implementations MAY create their own runner.** The reference runner only
  consumes public package entry points; it requires no private/internal
  utility.
- **Vectors are normative.** They are hand-written from the specification.
  Never generate `expected` from implementation output. If the reference
  implementation fails a vector, the implementation is wrong.

## Suite versioning

The suite has its own version (`conformance/manifest.json` →
`suite_version`, currently `0.1.0`), independent of the manifest schema
versions and npm package versions. See COMPATIBILITY.md.

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
| `ics` | `{ manifest, options: { now, include? } }` | `golden` (byte-exact file), `contains`, `not_contains`, `artifact_counts`, `max_octets_per_line`, `crlf_only`, `uid_pattern`, `uid_not_contains`, or `export_error` |

ICS vectors inject `options.now` so output is byte-deterministic. Golden
`.ics` files live in `vectors/ics/golden/`.

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
