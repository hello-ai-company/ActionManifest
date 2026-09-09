# Security Policy

## Supported versions

Phase 1 (`0.1.x`) is the only published line.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository, or email the maintainers listed on the org profile. Do not open a public issue for secrets or data-leak bugs.

## What we consider in scope

- Prompt / extractor paths that exfiltrate source documents beyond the configured provider
- Logging of full documents or API keys
- Schema validation bypass that lets unverified Actions look verified
- Path traversal in the CLI file adapters

## Out of scope

- Hallucinated Actions that the deterministic verifier already rejects
- Live LLM quality when `--provider openai` is used as designed (source leaves the machine)

## Secrets

Never commit `.env`. Rotate any key that was pasted into a ticket or chat.

This repository is public. See [docs/PUBLIC-BOUNDARY.md](docs/PUBLIC-BOUNDARY.md). Real user documents and production Evidence are out of scope for fixtures; mixing them in is a merge blocker (ENG-20260909-001).
