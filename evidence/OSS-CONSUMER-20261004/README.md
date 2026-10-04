# Generic OSS local consumer follow-up

Reviewed base: PR15 head `d50220f871a9627a4b9565b5044c9060bf653d41`.
Node 24.19.0 / pnpm 11.23.0. Saved environment restarted successfully.
No .agents/skills was present; AGENTS.md was read. No subagents used.

Reused pack-check.ts, cli-install-smoke.ts and the maintained docs/examples.
Found and fixed two onboarding inconsistencies: CLI README incorrectly said no
release was published, although existing rc.0 differs from these branch additions;
the offline SDK example used environment-sensitive default provider selection.
Now the example explicitly constructs DeterministicProvider and the CLI README
labels unpublished branch bytes by commit/hash without changing package versions.
Added docs/LOCAL-CONSUMER.md for generic users, version axes, exact local tarball
adoption, semantic limits, license scope and separate pre-publication operations.

Extended the shared actual-installed CLI proof to install SDK dependencies
directly, transpile and execute those same maintained examples against package
exports (no source aliases), and check real JSON/ICS file output. First SDK probe
failed because pnpm does not expose the CLI's transitive SDK dependencies as the
consumer's direct imports. The proof now checks CLI-only import/bin first, then
declares the SDK packages the examples import. No hoisting assumption or new
pipeline implementation. Installed examples explicitly set an OpenAI environment
and forbid fetch, proving the local deterministic example does not call it.

Measured final pre-packaging checks: build, governance, lint, typecheck, frozen
schema and docs checks PASS; standard **684/684**; integration **44/44**;
universal conformance **65/65**, critical false exported 0; reference **4/4**;
docs:examples PASS; pack:check PASS for 10 tarballs, per-library types/runtime,
actual foreign CLI/subpath import, SDK examples, JSON and ICS. Installed quick
start: 2 ready Actions, ICS 394 bytes. Mixed example: 1 verified/exported and
1 failed/withheld. Assertions validate JSON and withhold fabricated/rain dates.

Initial default-sandbox docs run stopped on tsx's local IPC socket EPERM.
Reran checks with the execution tool's reviewed network capability, allowing the
local socket; no credentials or product/API permissions were added. Normal
dependency package-manager operations are separate from LLM/execution APIs.
No tests were removed or schema/verifier policy relaxed.

Package labels remain lockstep 0.9.0-rc.0; manifest schemas 0.1/0.2 frozen;
conformance suite 0.2.0. These artifacts are unpublished local bytes, not a new
registry version or replacements for existing rc.0. LICENSE/NOTICE and required
dist/schema/CLI assets are checked by existing pack gates. Third-party licenses
are separately recorded in the dry-run SBOM, not relabeled Apache-2.0.

No push/merge, npm version/tag/publication, GitHub Release, production/DB changes,
real documents or paid API calls. Common core remains reusable without Matoe;
product projection refusals do not constrain generic rich manifests. Verification
is bounded rule-based support checking, not proof of source authenticity, full
semantic understanding or human approval/execution authority. A semantic contract
change was not necessary.

Next: produce clean local-commit dry-run artifacts with SHA256SUMS and manifest,
check actual licenses/assets, replay the manual adoption steps and two-run byte
reproducibility. Results/commit/hashes are reported after running, not predeclared.
Before any real release, separately authorize the follow-up review/push/merge and
an unused lockstep version, then use the existing exact-SHA FULL release gate,
canonical artifact and staged OIDC/human-2FA workflow plus registry verification.
No release-readiness or physical-device/live-service success is claimed here.

## Completed candidate proof

Exact artifact source: clean local commit
`6640eb13c2a5d53f1068cf3a3bd9d7a3d8c27d9b` (git.dirty=false).
release:dry-run PASS: 10 retained tarballs, SHA256SUMS, release-manifest.json,
CycloneDX 1.5 SBOM validated offline (14 external components).
release:reproducibility --runs 2 PASS: 10 packages x 2 runs byte-identical.
All 10 tarball checksums match; LICENSE/NOTICE are byte-identical to repository
roots, package versions lockstep rc.0, no source/test/env payload leakage, public
CLI agent export and dist are present. Candidate hashes: artifact-validation.json.
CLI SHA-256: `a915215fb0ef5505498243b014c66f098dc0297d713a6c8fef8c99882d836ea8`.

Manual adoption also PASS: a separate fresh npm consumer installed 9 local exact
tarballs with --offline (native adapter excluded), after preparing a disposable
third-party cache with ordinary public-registry package metadata/bytes. No global
install, credentials, install scripts, audit, registry writes or paid APIs.
Copied JavaScript-compatible maintained quick start ran directly as .mjs:
2 ready Actions, 394-byte ICS. Real CLI wrote schema 0.2 JSON and ICS primary
2026-10-15 while withholding conditional 2026-10-22; JSON/source validate PASS;
conformance 65/65; public agent entry PASS, execution_allowed=false. Both SDK
examples additionally passed installed tarballs in the shared pnpm proof, including
the mixed unsupported deadline refusal. This new local consumer ran Node 24.19.0;
the earlier d50220f remote PR proof covered Node20 and Linux Node22 Xberg. No
remote CI was triggered for this unpushed documentation/install-proof follow-up.

Required ordinary dependencies have license metadata (MIT / BSD-3-Clause);
ActionManifest packages are Apache-2.0. Five optional non-installed native Xberg
platform binary entries have unresolved license metadata in the existing SBOM
generator. Those platforms were not fetched or executed, and need separate legal
review if included in release attestations. This does not affect the nine-package
ordinary-consumer proof; it limits any all-platform release-readiness claim.

This final evidence/docs-only receipt is later than the pinned candidate source;
it does not replace the retained artifact commit or hashes. Review/push/merge,
unused lockstep version selection and FULL staged-release work remain separate
authorized steps. No frozen/common contract changes, publication or push occurred.
