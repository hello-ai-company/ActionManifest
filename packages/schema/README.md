# @actionmanifest/schema

Language-neutral Action Manifest JSON Schemas (immutable, versioned: `v0.1`,
`v0.2`) and the corresponding TypeScript types. This package is the contract;
everything else is an implementation.

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`.

```bash
npm install @actionmanifest/schema     # once published
```

Requires Node.js >= 20. No runtime dependencies.

## Usage

```ts
import {
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  actionManifestSchemasByVersion,
  type ActionManifest,
} from "@actionmanifest/schema";

// Raw schemas for non-TypeScript tooling are exported as subpaths:
import schemaV02 from "@actionmanifest/schema/schemas/v0.2/action-manifest.schema.json";
```

## Rules

- Published schema versions are **immutable** — frozen, sha256-pinned, and
  governance-enforced in CI. A change ships as a new `schema_version`.
- Readers dispatch by the manifest's `schema_version` and fail closed on
  unknown versions.

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `packages/schema`)
- Versioning policy: [docs/COMPATIBILITY.md](../../docs/COMPATIBILITY.md)
- Specification: [docs/SPECIFICATION.md](../../docs/SPECIFICATION.md)

Apache-2.0.
