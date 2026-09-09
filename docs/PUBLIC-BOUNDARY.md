# Public boundary

**This repository is public. Every commit is public.**

PA-dev-meeting HARD gates (ENG-20260909-001 / closed PA-20260909-001):

1. Only OSS core code, **synthetic** Golden fixtures, and architecture/spec docs.
2. Core does not write to calendars, email, Todoist, or similar.
3. Review owner after PR open: **PA-03E**. Do not start a second cloud agent.
4. `evidence/ENG-20260909-001/` will be **filled by Eng ops after review**.
5. If real PII or non-synthetic fixture risk appears: stop and report PARTIAL.

## Publishable (OK in this repo)

- Action Manifest JSON Schema and TypeScript types
- Canonical Document, adapters, verifier, temporal, extractor interfaces
- OpenAI-compatible client **shape** (no keys)
- Hand-written synthetic fixtures and Golden notice (not production mail)
- CLI and local JSON/ICS exporters
- Architecture / specification / “Otayori is out of this repo” boundary docs
- CI, Apache-2.0, Contributor Covenant

## Forbidden (must not be committed)

- Real documents, customer names, real personal schedules
- Email fragments, internal memos
- Secrets, API keys, `.env` values
- Otayori-specific features (child profiles, family inbox, billing, OAuth, notifications)

## Fixtures

All files under `benchmark/fixtures/` and `examples/` are synthetic templates authored for this OSS. Mixing in user or production text is a merge blocker and a PARTIAL stop.

## Evidence path

`evidence/ENG-20260909-001/` — Eng ops fills this **after** PA-03E review. Agents must not treat it as a place to dump internal memos.
