# @actionmanifest/consumer

Reference consumer policy: classify verified Actions into
**ready / review_required / blocked**. Never executes anything — consumption
decisions stay with your application.

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`.

```bash
npm install @actionmanifest/consumer   # once published
```

Requires Node.js >= 20.

## Usage

```ts
import { classifyManifest, readyActions } from "@actionmanifest/consumer";

const report = classifyManifest(manifest);
console.log(report.counts); // { ready, review_required, blocked }

for (const action of readyActions(manifest)) {
  // safe to present for one-tap acceptance
}
```

The classification shares its trust predicate with the exporters
(`evaluateActionTrust` in `@actionmanifest/core`), so what the consumer calls
ready is exactly what the default export policy ships.

## Key exports

- `classifyManifest(manifest)` → per-Action dispositions + counts
- `readyActions(manifest)`
- `CONSUMABLE_STATUSES`
- `manifestFatalReasons` (re-exported from core)

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `packages/consumer`)
- Integration contract: [docs/INTEGRATION-CONTRACT.md](../../docs/INTEGRATION-CONTRACT.md)

Apache-2.0.

## Matoe compatibility

`prepareMatoeManifest(input, canonicalSourceText)` returns an explicit v0.1 wire
manifest together with a mandatory full-original audit bundle. It refuses unsafe
or incomplete projections and never executes actions. See
[the Matoe integration guide](../../docs/MATOE-COMPATIBILITY.md) for the profile,
refusal policy, CLI usage, and unverified Swift/HTTP boundaries.
