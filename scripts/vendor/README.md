# Vendored schemas

Official JSON Schemas vendored for **offline** validation in release tooling
(`scripts/sbom-validate.ts`). Never fetched remotely at validation time.

| File | Source | Purpose |
| --- | --- | --- |
| `cyclonedx-1.5.schema.json` | [CycloneDX specification](https://github.com/CycloneDX/specification) `master/schema/bom-1.5.schema.json` | SBOM validation (CycloneDX 1.5, JSON Schema draft-07, strict: root `additionalProperties: false`) |
| `spdx.schema.json` | same repo, `schema/spdx.schema.json` | sub-schema (`$ref`) for license IDs |
| `jsf-0.82.schema.json` | same repo, `schema/jsf-0.82.schema.json` | sub-schema (`$ref`) for JSF signatures |

License: Apache-2.0 (CycloneDX specification). Vendored 2026-09-09 for
PA-20260910-001 Phase 2.3. Update policy: re-vendor only with a CHANGELOG
note; the SBOM spec version we emit stays `1.5` until a deliberate bump.
