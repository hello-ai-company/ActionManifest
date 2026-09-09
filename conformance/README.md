# ActionManifest Conformance Suite

Language-neutral contract tests for ActionManifest. Any implementation — TypeScript, Python, Rust, Go — that passes these vectors against the normative documents is **ActionManifest conformant**.

- Normative docs: [docs/SPECIFICATION.md](../docs/SPECIFICATION.md), [docs/INTEGRATION-CONTRACT.md](../docs/INTEGRATION-CONTRACT.md), [docs/STANDARDS.md](../docs/STANDARDS.md)
- How to run / write vectors / exit codes: [docs/CONFORMANCE.md](../docs/CONFORMANCE.md)
- Versioning (schema vs package vs suite): [docs/COMPATIBILITY.md](../docs/COMPATIBILITY.md)

## Layout

```
conformance/
  manifest.json        # suite version + profile registry (schema-validated)
  schema/              # Draft 2020-12 meta-schemas for the suite itself
    suite-manifest.schema.json
    profiles/          # one schema per vector profile
  vectors/
    schema/            # Action Manifest JSON Schema acceptance/rejection
    canonical-document/# CanonicalDocument contract + semantic validation
    evidence/          # Evidence provenance verification
    trust/             # shared trust policy (consumer == exporter)
    temporal/          # Temporal → downstream export semantics
    ics/               # RFC 5545 SEMANTIC checks (universal)
    reference-serialization/  # byte-exact .ics goldens (TypeScript regression only)
```

**Universal ≠ reference.** The `ics` profile checks semantics (components,
UID/DTSTART/SUMMARY/COMMENT content, octet limits, CRLF, escaping) — property
order, PRODID, fold positions, and DTSTAMP lexical details are implementation
freedom. `reference-serialization` is the byte-exact regression gate for the
TypeScript implementation only and never affects universal conformance.

## Rules

1. **Vectors are normative.** They are hand-written from the specification. Never generate `expected` from implementation output. If the reference implementation fails a vector, fix the implementation.
2. **Language-neutral.** Vectors are plain JSON (plus golden `.ics` files). No TypeScript types, no helper imports.
3. **Vectors are schema-validated.** Every vector passes its profile meta-schema (`conformance/schema/`) before execution; malformed vectors are runner/config errors (exit 2), never silent passes.
4. **Public API only.** The reference runner (`pnpm conformance`) uses only public package entry points; third parties MAY write their own runners.
5. **Deterministic and offline.** No network, no wall-clock dependence (ICS vectors inject `now`).
6. **Versioned.** Changing normative contents (`vectors/`, `schema/`, `manifest.json`) without bumping `suite_version` fails CI (`pnpm governance:validate`). Reference-serialization goldens are exempt.

## Run

```bash
pnpm conformance            # universal suite
pnpm conformance:smoke      # trust + ics (safety-critical profiles)
pnpm conformance:reference  # universal + TypeScript serialization regression
pnpm actionman conformance --json
```
