# @actionmanifest/cli

`actionman` — the ActionManifest command line: extract verifiable Actions
from documents, validate manifests, run the benchmark, and check the
official conformance suite.

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`. The commands below are verified on every
> PR by installing the packed tarball into a fresh project.

```bash
npm install -g @actionmanifest/cli     # once published
actionman --help
npx actionman conformance              # without global install
```

Requires Node.js >= 20. No native dependencies: the Xberg adapter is a
separate, optional package and is never installed by this CLI.

## Commands

### `actionman extract <file>`

Extract a candidate Action Manifest from a plain-text document.

| Option | Effect |
| --- | --- |
| `--json` | write the manifest JSON to stdout (pure JSON — nothing else on stdout) |
| `--out <file>` | write the manifest JSON to a file |
| `--ics <file>` | write an iCalendar (VEVENT/VTODO) export to a file |
| `--provider <name>` | `deterministic` (default, offline) or `openai` (needs `OPENAI_API_KEY`; source text leaves the machine toward `OPENAI_BASE_URL`) |
| `--skip-verify` | do not run the deterministic verifier |
| `--include-unverified` | export proposed/unverified actions too (default: verified-only) |

Exit codes: `0` success · `1` usage/IO error · `2` verification did not fully pass.

### `actionman validate <manifest>`

Validate a manifest against its frozen schema; with `--doc <file>`, also run
per-Action evidence verification against the source document.

| Option | Effect |
| --- | --- |
| `--doc <file>` | source document for evidence checks |
| `--json` | machine-readable per-Action results (`flags.actions[]`) |

Exit codes: `0` valid (and verified, with `--doc`) · `1` invalid/IO error ·
`2` verification did not fully pass.

### `actionman conformance`

Run the language-neutral universal conformance suite. **The suite is bundled
into this package** — it runs from any directory, no repository checkout
needed. Official conformance = normative docs + vector meta-schemas +
vectors; this TypeScript runner is not the spec.

| Option | Effect |
| --- | --- |
| `--root <dir>` | run a different (self-contained: manifest + schema + vectors) suite |
| `--smoke` | only the safety-critical profiles (trust, ics) |
| `--reference` | additionally run the TypeScript byte-exact serialization regression (never part of universal conformance) |
| `--json` | machine-readable report |

Exit codes: `0` conformant · `1` conformance failure · `2` runner/config error.

### `actionman benchmark`

Run the synthetic JP+EN benchmark (74 fixtures, 40 adversarial), bundled
with the package. Gated on critical false-verified = 0.

| Option | Effect |
| --- | --- |
| `--fixtures <dir>` | use a different fixture root |
| `--smoke` | small CI subset |
| `--json` | machine-readable summary |

Exit codes: `0` pass · `1` IO error · `2` golden regression or any critical
false-verified action.

## Conventions

- Data goes to **stdout**; errors go to **stderr**. `--json` output is pure
  JSON (pipeable to `jq`).
- The CLI reads only the paths you pass it (plus its bundled suite/corpus).
  It is not a sandbox; do not run it as a privileged user on untrusted
  input.

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `apps/cli`)
- Library usage: [README](../../README.md#using-actionmanifest-as-a-library)
- Conformance: [docs/CONFORMANCE.md](../../docs/CONFORMANCE.md)
- Security: [SECURITY.md](../../SECURITY.md)

Apache-2.0.
