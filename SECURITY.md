# Security Policy

## Supported versions

Supported source line on `main`: **Phase 1 `0.1.x`** (release-candidate
preparation for `0.9.0-rc.1`; see [docs/RELEASING.md](docs/RELEASING.md)).

**As of 2026-09-10: no npm publish, no git tag, no GitHub Release.** The
`@actionmanifest/*` scope does not exist on the public npm registry
(verified read-only on 2026-09-09: all names return 404), the repository
root package is `private: true`, and no publish workflow exists. Security
fixes land on `main` and are announced in the release notes of the next RC.
After a first publish, only the latest `0.x` line will receive fixes before
1.0.

| Line | Status |
| --- | --- |
| `0.x` source on `main` (RC prep) | Supported |
| npm packages | None exist (never published) |
| Git tags / GitHub Releases | None exist |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository
(**Security → Advisories → Report a vulnerability**), or email the maintainers
listed on the org profile. Do not open a public issue for secrets or
data-leak bugs. We aim to acknowledge reports within 3 business days.

## What we consider in scope

- **Verification bypass**: any path that lets an Action whose evidence,
  temporal, actor, or modality checks failed appear verified or reach the
  default export set (critical false-verified / critical false-exported).
- **Source leakage**: prompt / extractor paths that exfiltrate source
  documents beyond the configured provider, or logging of full documents or
  API keys.
- **CLI path safety**: *unexpected* resolution outside the intended
  fixture/conformance roots — e.g. a suite or fixture path that escapes its
  root, or the CLI reading/writing files the caller did not intend.
- **Schema validation bypass**: inputs that validate against the wrong schema
  version or smuggle fields across versions.
- **Supply chain**: tampered tarballs, unexpected dependencies (e.g. the
  native Xberg binding appearing outside `@actionmanifest/adapter-xberg`),
  or release-process weaknesses.
- **Remote Xberg fetching**: `XbergAdapter` must never fetch remote URLs
  unless the caller explicitly passes `allowRemote: true`.

## Out of scope

- **Intentional local reads**: the caller explicitly passing a filesystem
  path to `actionman extract <file>` / `validate <manifest>` (or `--doc`,
  `--root`, `--fixtures`) is the CLI working as designed — it is a local
  tool reading local files the user named.
- Hallucinated Actions that the deterministic verifier already rejects (that
  is the verifier working as designed).
- Live LLM quality when `--provider openai` is used as designed — with that
  provider, source text **leaves the machine** toward `OPENAI_BASE_URL`. The
  default provider is fully local.
- Vulnerabilities in upstream parsers (Docling, Xberg) themselves — report
  those upstream; we track their advisories for the adapter packages.

**No sandbox claims:** the CLI is not a sandbox, and we do not claim
unverified isolation guarantees. Do not run it as a privileged user on
untrusted input.

## Hardening properties (verified by CI gates)

- The default pipeline is fully offline and deterministic; no network calls
  are made without an explicit opt-in (`--provider openai`, or
  `allowRemote: true` on the Xberg adapter).
- The universal conformance suite gates **critical false exported = 0** on
  every commit; the adversarial benchmark gates **critical false-verified =
  0**.
- Release artifacts are verified before any publish: `pnpm release:check`
  packs every package, installs the tarballs into fresh projects, and runs
  the conformance suite from the installed CLI.

## Secrets

Never commit `.env`. Rotate any key that was pasted into a ticket or chat.

This repository is public. See [docs/PUBLIC-BOUNDARY.md](docs/PUBLIC-BOUNDARY.md).
Real user documents and production Evidence are out of scope for fixtures;
mixing them in is a merge blocker (ENG-20260909-001).
