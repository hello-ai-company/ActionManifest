# ActionManifest Conformance Suite

Language-neutral contract tests for ActionManifest. Any implementation — TypeScript, Python, Rust, Go — that passes these vectors against the normative documents is **ActionManifest conformant**.

- Normative docs: [docs/SPECIFICATION.md](../docs/SPECIFICATION.md), [docs/INTEGRATION-CONTRACT.md](../docs/INTEGRATION-CONTRACT.md), [docs/STANDARDS.md](../docs/STANDARDS.md)
- How to run / write vectors / exit codes: [docs/CONFORMANCE.md](../docs/CONFORMANCE.md)
- Versioning (schema vs package vs suite): [docs/COMPATIBILITY.md](../docs/COMPATIBILITY.md)

## Layout

```
conformance/
  manifest.json        # suite version + profile registry
  vectors/
    schema/            # Action Manifest JSON Schema acceptance/rejection
    canonical-document/# CanonicalDocument contract + semantic validation
    evidence/          # Evidence provenance verification
    trust/             # shared trust policy (consumer == exporter)
    temporal/          # Temporal → downstream export semantics
    ics/               # RFC 5545 output (incl. byte-exact golden files)
```

## Rules

1. **Vectors are normative.** They are hand-written from the specification. Never generate `expected` from implementation output. If the reference implementation fails a vector, fix the implementation.
2. **Language-neutral.** Vectors are plain JSON (plus golden `.ics` files). No TypeScript types, no helper imports.
3. **Public API only.** The reference runner (`pnpm conformance`) uses only public package entry points; third parties MAY write their own runners.
4. **Deterministic and offline.** No network, no wall-clock dependence (ICS vectors inject `now`).

## Run

```bash
pnpm conformance            # full suite
pnpm conformance:smoke      # trust + ics (safety-critical profiles)
pnpm actionman conformance --json
```
