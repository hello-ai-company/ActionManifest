# @actionmanifest/verifier

Deterministic Action Manifest verifier. **No LLM.** Verification is
**per Action**: each Action is checked independently against the source
document, so one bad Action never invalidates the valid ones.

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`.

```bash
npm install @actionmanifest/verifier   # once published
```

Requires Node.js >= 20.

## Usage

```ts
import { verifyManifest, verificationPassed } from "@actionmanifest/verifier";

const { manifest, flags } = verifyManifest(candidate, doc);
if (!verificationPassed(flags)) {
  // flags.actions[] carries per-Action results; the manifest verdict is a
  // summary, not a gate.
}
```

Checks per Action: evidence support (quote must appear in the source),
temporal support (a declared calendar date must be supported by evidence —
hallucinated deadlines fail), actor/modality support, negation conflicts,
page references. Manifest-level fatals (empty source, source hash mismatch)
are cross-cutting and block all promotion.

## Key exports

- `verifyManifest(manifest, doc, options?)` → `{ manifest, flags }`
- `verifyAction(action, doc, source, manifest)`
- `verificationPassed(flags)`, `actionVerificationPassed(result)`

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `packages/verifier`)
- ADR: [docs/adr/0002-per-action-verification.md](../../docs/adr/0002-per-action-verification.md)

Apache-2.0.
