# @actionmanifest/temporal

Deterministic Japanese/English temporal and modality parsing.
**Unknown stays unknown** — this package never invents a date
(「10月頃」 does not become `2026-10-01`).

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`.

```bash
npm install @actionmanifest/temporal  # once published
```

Requires Node.js >= 20.

## Usage

```ts
import { parseTemporals, primaryTemporal, detectModality } from "@actionmanifest/temporal";

const hits = parseTemporals("令和8年10月15日に提出してください。");
const primary = primaryTemporal("令和8年10月15日に提出してください。");
const { modality, conditions } = detectModality("必ず提出してください");
```

## Key exports

- Parsing: `parseTemporals`, `primaryTemporal`, `extractYearContext`
- Japanese era conversion: `reiwaToGregorian`, `heiseiToGregorian`,
  `showaToGregorian`
- Cues: `isApproximateCue`, `isNegation`, `isCancellationContext`,
  `isReferenceContext`, `isPastCompletedContext`, `isCorrectionContext`,
  `correctionCueIndex`
- Classification: `detectModality`, `detectKind`

Full reference: [docs/API.md](../../docs/API.md).

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `packages/temporal`)

Apache-2.0.
