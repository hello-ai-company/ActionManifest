# Local Matoe / agent recovery follow-up

Base: main `cf2f3f48b515bd7aed8f02f0e8843ca97840b1bb` (PR15 merged).
Working branch: `fix/matoe-recovery-contract`.
Node 24.19.0 / pnpm 11.23.0, offline dependency cache. AGENTS.md read;
no related .agents/skills found. Previous work/branch preserved.

## Reproduced problems and changes

- The public in-process agent calculated input_fingerprint after extraction's
  await. Mutating the caller's object could attach the changed-input fingerprint
  to the original-input result. A regression failed before the fix; the
  fingerprint is now captured before the first yield.
- Matoe's in-process helper reread sourceId/ocrText after extraction. Caller
  mutation caused a safe contract refusal, rather than a stable original-input
  response. The validated primitive strings are now captured before extraction;
  the mutation regression checks original source/hash/actions.
- Unsupported analyze-matoe flags produced Commander text and echoed an
  argument marker. Built CLI regression reproduced two failures before the fix.
  Both machine entries now validate argv before Commander handles help/version:
  exactly --stdin-json is the machine invocation; standalone --help/-h remains
  human help; mixed or unsupported arguments return fixed JSON and exit 1.
- Added actual built CLI tests for repeated proposals, invalid/blocked/valid
  recovery, just-spawned unfinished-stdin process termination plus a fresh
  process, and parallel Matoe request/source/hash/evidence isolation. Every
  synthetic probe runs in an empty foreign cwd; no files are created there.
- Added docs/MATOE-RECOVERY.md and included it plus tests/agent instructions in
  the existing local offline bundle source allowlist. No new pipeline/executor.

An intermediate compile check caught CanonicalDocument.text's optional type;
the final helper snapshots its already-validated string inputs instead. The
final checks below run after this correction. No failing tests were removed.

## Independent review

One read-only reviewer examined the diff and trust/compatibility boundaries.
It recommended the Matoe input snapshot, pre-Commander argument guard and precise
termination-test wording; all were applied. Re-review reported no remaining
change requests and confirmed mutation and mixed-argument behavior. Full-suite
measurement belongs to this implementing thread; the review is not an external
product approval or physical-device proof.

## Measured final code checks

Command log: /tmp/am-recovery-final-checks.log (non-secret local test log).

| Check | Result |
| --- | --- |
| governance / lint / typecheck / frozen schema | PASS |
| Standard suite | 686/686, 55 files |
| Integration via built package exports | 57/57, 10 files |
| Universal conformance | 65/65 |
| Reference serialization | 4/4 (TypeScript regression, not universal conformance) |
| Benchmark smoke | PASS; critical false-verified 0 |
| release:check:quick | PASS |
| Pack / installed SDK examples / agent subpath / CLI JSON+ICS | PASS, 10 packages |
| docs check / maintained examples | PASS |
| Dry-run SBOM | PASS, official CycloneDX 1.5 validation, 14 external components |
| Reproducibility | 10 packages x 2 runs byte-identical |

The first quick dry-run was on a dirty development tree and recorded that fact;
it is not a clean candidate attestation. Clean committed artifact provenance,
archive/tarball hashes and replay results are reported separately after packaging.
This task does not claim final-head remote CI or FULL release readiness. Package
versions remain rc.0; the new bytes are unpublished and identified by commit/hash.

## What remains outside this proof

No frozen schema, shared verification policy or approval lifecycle was weakened.
Old 0.1 projection and full 0.2 golden/mixed/negative contracts still pass. The
CLI's repeatable proposals are not durable deduplication or execution
idempotency. The termination test kills just after spawn; it does not establish
stdin reader startup or simulate a crash during extraction. Bounded retries,
HTTP timeout/truncation/late responses and durable approval/storage reconciliation
remain Matoe-owned and need actual product tests.

No Otayori edits, new auth/permissions, paid API, real-document transmission,
production/DB/deploy, npm publication, push or merge. The existing merged main
still supplies the earlier remote CI/FULL/Node20/Node22 proofs; they do not cover
this new local commit. Device/live backend/external agent tests and optional
native-platform license review remain separate. The minimal next step is to
review this exact local candidate in Matoe's explicit 0.2 route and perform the
product acceptance checks in docs/MATOE-RECOVERY.md.
