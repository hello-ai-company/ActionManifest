# @actionmanifest/consumer

Reference consumer policy: classify verified Actions into
**ready / review_required / blocked**. Classification never executes actions;
consumption decisions stay with your application. An opt-in, separately invoked
local workflow coordinator is described below.

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`.

```bash
npm install @actionmanifest/consumer   # once published
```

Requires Node.js >= 20.

## Usage

```ts
import { classifyManifest, readyActions } from "@actionmanifest/consumer";

const report = classifyManifest(manifest);
console.log(report.counts); // { ready, review_required, blocked }

for (const action of readyActions(manifest)) {
  // safe to present for one-tap acceptance
}
```

The classification shares its trust predicate with the exporters
(`evaluateActionTrust` in `@actionmanifest/core`), so what the consumer calls
ready is exactly what the default export policy ships.

## Key exports

- `classifyManifest(manifest)` → per-Action dispositions + counts
- `readyActions(manifest)`
- `CONSUMABLE_STATUSES`
- `manifestFatalReasons` (re-exported from core)

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `packages/consumer`)
- Integration contract: [docs/INTEGRATION-CONTRACT.md](../../docs/INTEGRATION-CONTRACT.md)

Apache-2.0.

## Matoe compatibility

This is optional and separate from the generic classification above. Importing
this package or calling `classifyManifest` does not select a Matoe profile.
Source-supported role, conditions, notes, timezone and multiple Evidence remain
in generic manifests; `ready` does not mean the consuming UI has rendered them
or that the user has approved an action. Validate external JSON with
`validateActionManifest` and verify it against your canonical source before
using a receipt as your own verification result.

`prepareMatoeManifest(input, canonicalSourceText)` returns an explicit v0.1 wire
manifest together with a mandatory full-original audit bundle. It refuses unsafe
or incomplete projections and never executes actions. See
[the Matoe integration guide](../../docs/MATOE-COMPATIBILITY.md) for the profile,
refusal policy, CLI usage, and unverified Swift/HTTP boundaries.

Use `MATOE_INPUT_LIMITS` only when working with that Swift wire contract. Its
budgets and display restrictions do not apply to the general extractor/verifier
or `classifyManifest`. A projection failure leaves the full original available
to other consumers; never remove unsupported fields to make it pass. See the
[shared/product boundary](../../docs/OTAYORI-BOUNDARY.md) for both public paths.

For the separately implemented new Swift v0.2 route,
`prepareMatoeV02Manifest(input, canonicalSourceText, expectedSourceId)` checks a
complete, consistent full-fidelity receipt without dropping any field or failed
Action. Failed Actions remain blocked. It is incompatible with the old 0.1
bridge; do not silently select it. See the
[explicit offline server contract](../../docs/MATOE-SERVER-V02.md).

## Opt-in local conversational workflow (0.1.0)

The classification, assistance projection, and wire import APIs above remain read-only.
The separately invoked `LocalWorkflowCoordinator` can create **device-local task and
all-day schedule records** through a trusted host adapter after exact confirmation.
It has no external-service, payment, submission, signing, messaging, or family-sharing
operation. An action saying “submit” creates a reminder only.

See [the portable workflow contract](../../docs/assistance/LOCAL-WORKFLOW.md) for
serialized types, confirmation, atomic adapter obligations, recovery, limits, and
verified file-backed examples. This is a deterministic planning/execution protocol;
it is not an LLM, and it does not claim a general natural-language agent is connected.

## Read-only action explanations

`explainManifest(manifest, { includeEvidence: false })` and `formatActionGuidance(report)`
produce a deterministic Japanese next-step guide from the existing consumer trust
classification. They retain every candidate, including blocked ones, and explain
missing verification, conditional applicability, ambiguous dates, actor uncertainty,
unknown kinds and the boundary around payment, sending, submission and signature.
The report is display-only. It does not evaluate local household facts, authorize an
operation, prove current permissions/connectivity, or show real-world completion.

The library reports `verification_basis: "supplied_receipt_only"`: it does not
reverify external receipts. For a source-bound command, use the new offline CLI:

```sh
pnpm actionman explain candidate.json --doc exact-source.txt
pnpm actionman explain candidate.json --doc exact-source.txt --json
pnpm actionman explain candidate.json --doc exact-source.txt --include-evidence
```

The CLI requires a schema 0.2.0 proposed/verified candidate with matching source
hash and extraction provenance. It reuses the existing bounded `agent` verifier
path before building the guide. Existing accepted/rejected/exported data is not
rewritten or reset; it is outside this candidate command. Exit 0 means the guide
was produced with no blocked/review-required verification rows, never that an action
can execute. Exit 2 retains blocked/review-required candidates in the guide; exit 1
means input/verification setup failed. It makes no provider, browser or network call
and writes only the explicitly requested stdout report.

Evidence quotes are omitted by default and included only with `--include-evidence`.
The guide still contains action titles (and action IDs in JSON), so it is not an
anonymized report. JSON with opted-in evidence preserves exact source values.
Plain terminal output flattens control, newline and direction-changing characters
in source strings; source text remains inert data, never instructions. Error output
uses a fixed message instead of file paths, excerpts or provider diagnostics.

## Plan impact and interruption guidance

`previewLocalWorkflowImpact(plan, { now, context?, prior_workflows? })` groups exact
local changes by destination and separates blocked/review items and historical
duplicate hints. `adviseLocalWorkflowRecovery(privateWorkflowJson, { now, context? })`
explains partial, uncertain, cancelled, expired and stale snapshots. Both return
strictly display-only, non-authorizing reports and never call a host or retry work.
The matching terminal formatters accept the original plan/snapshot and options.
See [workflow insights](../../docs/assistance/WORKFLOW-INSIGHTS.md) for limits,
examples, safe recovery distinctions and snapshot/privacy caveats.
