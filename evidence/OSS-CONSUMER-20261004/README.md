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
