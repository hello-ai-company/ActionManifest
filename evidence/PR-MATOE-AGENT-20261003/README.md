# Draft PR final review

Review base: main `18c159c0bbb238b410c003cc8e60e7a8e013309f`.
Reviewed prior tip: `15f71f98373b0ab1c705fd0bc2f76b590b5ac51e`.
Dedicated branch: `fix/matoe-explicit-compatibility`.

User authorized commit/push of this branch and Draft PR creation on 2026-10-03,
superseding the earlier no-push constraint for this scoped review. No force/main
push, merge, npm publication, deployment, paid CI purchase or permission changes.

Reviewed 80 changed files before the final fix. Credential-shaped value scan
(private-key/GitHub/OpenAI token patterns and credential assignments) returned no
hits; forbidden config/generated paths returned no hits. Fixtures are authored
synthetic notices. Large evidence JSONs are benchmark scores/timing/compatibility
measurements, not real documents. Existing performance probes and before/after
evidence support request-local optimization and limited English event recognition;
no population-wide superiority claim. Frozen schemas and conformance vectors are
unchanged. Common OSS contract remains separate from Matoe product constraints.

Final review found the limited v0.1 projection did not explicitly reject lone
Unicode surrogates although the v0.2 and agent paths already did. Added refusal
for canonical OCR and every manifest string, with four regression tests. Valid
wire/golden behavior is unchanged; malformed strings cannot reach Swift on hash
agreement alone. The documentation now labels the old Swift bridge as the pinned
research baseline instead of implying it describes the latest Matoe work branch.

Read-only remote review: main still at the base above, no open PRs at review time,
branch response reports protected=false and no required status-check contexts.
Only a release-tag ruleset was listed. This does not grant merge permission;
the existing CI and Release Check workflows must still be checked on PR head.
CLI GitHub API reads were Forbidden; connected GitHub reads succeeded. No new
credentials were added and no branch-protection/admin permission was requested.

Parent reports Mac-side verification of real 7453b33 CLI → Python HTTP → Simulator
Swift v0.2 acceptance with four synthetic candidates. Mixed/negative HTTP cases
were fixture replay, not fresh extraction. This cloud environment did not repeat
those Simulator checks. Physical iPhone, production, real-document E2E and external
agent connection remain unverified. Latest agent entry was separately artifact-
tested; the older personal Library bundle remains tied to 7453b33.

Local final checks and exact remote-head CI results are reported after they run;
this record does not predeclare success or substitute local tests for remote CI.

Final local checks after the Unicode fix: Node 24.19.0 / pnpm 11.23.0;
build, governance:validate against the base above, lint, docs:check, typecheck and
schema:validate PASS; standard **684/684**; integration **44/44**;
conformance **65/65**; reference serialization **4/4**;
benchmark:smoke and full benchmark PASS, critical false verified 0.
Prior agent-tip pack:check passed actual installed subpath/CLI and all 10 packages.
Exact PR-head CI results remain pending until the authorized push/PR occurs.
