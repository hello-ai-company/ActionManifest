# AGENTS.md

## Product
Turn documents into verifiable actions (ActionManifest monorepo: packages/* + apps/*).
Node >= 20, pnpm@11. Public packages / Trusted Publishing are out of band unless the brief says otherwise.

## Do
- Implement only the scoped paths in the Cloud Agent brief.
- Prefer one PR tip; one fix bundle for review comments.
- Run the Verify commands that match the change size, and paste summaries into the Eng evidence path named in the brief.
- Keep Draft PR unless the brief / President GO says undraft+merge.

## Do not
- npm publish / tag / GitHub Release / Trusted Publisher / flip NPM_TRUSTED_PUBLISHING_READY
- Widen into Otayori app UI (see docs/OTAYORI-BOUNDARY.md) unless the brief explicitly includes it
- Delete tests to green CI; put secrets in logs or evidence
- Open parallel Cloud Agents for the same ENG

## Verify (pick by scope)
- Always-ish: `pnpm docs:check` · `pnpm lint` · `pnpm typecheck` · `pnpm test`
- Schema/API: also `pnpm schema:validate`
- Release-shaped: `pnpm release:check:quick` (full `pnpm release:check` only when brief asks)
- Integration: `pnpm integration:test` when touching adapters/integration

## Evidence
- Record command outcomes + PR URL under the ENG evidence path from CoS/03E.
- Done = evidence gate, not "agent finished".

## Approval boundary
Merge / publish / tag / Release / prod = human GO only (L4 for publish path).
