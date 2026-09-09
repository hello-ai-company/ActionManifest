# @actionmanifest/core

Canonical document model, hashing, schema validation, trust evaluation, and
the error taxonomy. Core is local-only: **no network I/O, no writes to
third-party apps** (no calendar/email/Todoist calls — ever).

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`.

```bash
npm install @actionmanifest/core       # once published
```

Requires Node.js >= 20.

## Usage

```ts
import {
  validateActionManifest,
  assertCanonicalDocument,
  ensureSourceHash,
  evaluateActionTrust,
} from "@actionmanifest/core";

const doc = assertCanonicalDocument(ensureSourceHash({ id: "notice-1", text }));
const manifest = validateActionManifest(unknownJson); // dispatches by schema_version
const trust = evaluateActionTrust(action, verificationFlags);
```

## Key exports

- Validation: `validateActionManifest`, `tryValidateActionManifest`,
  `validateCanonicalDocument`, `assertCanonicalDocument`,
  `checkCanonicalDocument`
- Hashing/matching: `ensureSourceHash`, `canonicalText`, `sha256Hex`,
  `normalizeForMatch`, `sourceContainsQuote`
- Trust: `evaluateActionTrust`, `trustDispositionFor`, `manifestFatalReasons`
- Errors: `ActionManifestError` hierarchy incl. the adapter error taxonomy

Full reference: [docs/API.md](../../docs/API.md).

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `packages/core`)
- Integration contract: [docs/INTEGRATION-CONTRACT.md](../../docs/INTEGRATION-CONTRACT.md)

Apache-2.0.
