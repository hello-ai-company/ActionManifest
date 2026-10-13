# Matoe integration v1

Matoe already consumes the local `analyze-matoe` CLI output through strict v0.1/v0.2 validation, an immutable source archive and a separate native approval/adoption coordinator. This revision consolidates shared mapping rather than introducing a second extractor or executor.

`contracts/matoe/integration-v1.json` is the authoritative integration metadata. `scripts/generate-matoe-contract.py --matoe-root /path/to/matoe --check` verifies generated TypeScript, native Swift and the mirrored JSON. Omit `--check` only when intentionally regenerating after a reviewed contract change. The frozen ActionManifest schemas themselves are unchanged.

The metadata covers 13 known action kinds and all 101 native tool IDs. Native tools are advisory capabilities, not portable execution instructions. Unknown action kinds require review. Existing host approval, authority, exact source/evidence, condition, destination, cancellation and restart checks stay in place. Payment actions can describe local preparation records only; no transfer, purchase or external message executor is provided.

`readLocalExecutionReceipt(host, workflowID)` reuses the current coordinator's destination verification and returns a canonical, bounded, non-authorizing receipt. `canonicalLocalReceipt(receipt)` returns exact JSON and SHA256. The receipt cannot be imported as a plan or grant. It always states `device_local`, `authorization: none`, and `real_world_completion: false`. It contains opaque IDs/hashes, not source text or credentials. It does not replace the existing plan digest.

Both adapters use the shared fixtures at `contracts/matoe/receipt-fixtures-v1.json`. Portable tests exercise real local record readback and prove that asking for a receipt creates no new records. Native fixture tests are authored but require a later Mac/iPhone run; source/syntax checks are not native compilation.

Standalone ActionManifest behavior and the existing portable host remain available. No host-to-host double execution or implicit import of approvals was added. See the Matoe v20 completion matrix for URL preview, source-adapter hardening and native acceptance details.
