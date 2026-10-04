# Adopt the unpublished branch as a generic consumer

PR #15 base candidate is commit `d50220f871a9627a4b9565b5044c9060bf653d41`.
The documentation/install-proof follow-up in this checkout is local and unpushed.
Existing npm `0.9.0-rc.0` does not contain the new agent/Matoe APIs. Do not install
that version expecting the branch additions or replace its published bytes.

| Axis | This local build |
| --- | --- |
| Public package labels | All 10 remain `0.9.0-rc.0`; not a new registry release |
| Manifest schema | Frozen `0.1.0` and `0.2.0`; default `0.2.0` |
| Universal conformance suite | `0.2.0`, 65 vectors; 4 separate reference goldens |
| Builder | Node >=22, exact pnpm `11.23.0` |
| Consumer | Node >=20; optional native Xberg alone requires >=22 |

Identify an unpublished build with the exact commit, clean/dirty state and tarball
SHA-256 from its manifest, not its rc.0 label. Check release-manifest.json:
git.head/git.tree/git.dirty, versions, publish_order, packages and SHA256SUMS.
If dirty=true, it is a working-tree probe rather than an exact-commit candidate.
Neither a dry-run artifact nor successful tests authorize publishing or merging.

## Use existing local pack/install proof

From a built checkout with reviewed locked dependencies already installed:

```sh
pnpm build
pnpm docs:examples
pnpm pack:check
pnpm release:dry-run
```

These commands do not publish, tag, push or deploy. pack:check checks every
tarball's runtime/types/assets/Apache-2.0 LICENSE/NOTICE, then installs the CLI
and its declared local package dependencies in a fresh foreign project. It runs
the CLI first, then declares the SDK packages as direct dependencies and runs
the maintained SDK examples there, not source aliases, and tests the public
agent subpath and real bin. No new extraction/verification implementation is used.
The SDK examples explicitly choose DeterministicProvider; the installed proof
also disables network fetch and selects OpenAI in environment to prove isolation.

Dry run retains tarballs, SHA256SUMS, release-manifest.json and sbom.cdx.json under
gitignored release-artifacts/. Verify exact bytes before local use:

```sh
cd release-artifacts
sha256sum --check SHA256SUMS
```

Foreign-directory installation requires cached third-party dependencies for
fully offline execution. Missing cache is an environment prerequisite, not a
reason to substitute published ActionManifest packages or claim install success.

## Reproduce manually in a fresh consumer

Set repo to the absolute reviewed checkout path and create a new directory.
This follows the same local tarball selection as the existing consumer proof;
the optional native adapter is excluded. npm's cache must already contain the
third-party runtime dependencies for --offline. No global install is needed.
The shell example uses Bash brace expansion. The guide/examples stay in the
reviewed source checkout; the npm tarballs ship runtime/types/legal/CLI assets,
not the entire documentation repository.

```sh
repo=/absolute/path/to/ActionManifest
consumer_dir=$(mktemp -d)
cd "$consumer_dir"
npm init -y
npm install --offline --ignore-scripts --no-audit --no-fund \
  "$repo"/release-artifacts/tarballs/actionmanifest-{schema,core,temporal,adapters,extractor,verifier,consumer,exporters,cli}-0.9.0-rc.0.tgz
cp "$repo/docs/examples/library-quick-start.ts" ./library-quick-start.mjs
node library-quick-start.mjs
printf '%s\n' '令和8年10月15日に秋の遠足を実施します。雨天の場合は10月22日に延期します。' > sample.txt
./node_modules/.bin/actionman extract sample.txt --provider deterministic --json --ics sample.ics > manifest.json
./node_modules/.bin/actionman validate manifest.json --doc sample.txt --json
./node_modules/.bin/actionman conformance --json
./node_modules/.bin/actionman agent --stdin-json < "$repo/examples/agent-extract.json"
```

The quick-start .ts file deliberately uses JavaScript-compatible syntax and can
be copied to .mjs for Node20. It checks actual extraction, per-action verification,
human-review classification, schema-valid JSON and ICS primary/rain-date handling.
The same file is typechecked in docs:examples and run against installed tarballs.
per-action-verification.ts additionally checks one supported and one fabricated
deadline: only the supported Action exports. Its type syntax is transpiled by the
shared installed example proof; no change to its verifier policy is needed.

CLI JSON/ICS outputs are local files/strings. They do not write to a calendar,
send a reply or pay an invoice. Keep the full manifest, per-action receipt and
classification for human review before filtering for export. Default exporters
filter failed/unverified Actions; an exported subset is not the full review record.
verified and ready are not human approval or execution permission. Applications
own authenticated sources, approval persistence, execution and deduplication.

## Boundaries and semantic limits

Use generic adapters/core/extractor/verifier/consumer/exporters independently of
Matoe. The optional prepareMatoeManifest API is a deliberately small v0.1 product
projection that refuses unsupported fields and retains original audit data.
prepareMatoeV02Manifest checks Matoe wire integrity; it is not an independent
semantic verifier. Generic rich roles/conditions/notes/uncertain dates/alternatives
remain available even when the v0.1 product profile cannot represent them.

Schema validation proves shape/version, not truth. Verification checks source
quotes, temporal support, actor/modality/negation and page references using
deterministic rules. It is not arbitrary language understanding, OCR correctness,
source authenticity, or proof that each Action title/date association is intended.
Dates may be supported elsewhere in the source rather than exclusively by one
quote. Unknown/implicit actors can pass conservatively without identity proof.
Existing conformance and synthetic corpus results do not guarantee all documents.
Review complete evidence, warnings, conditions, alternatives and uncertainty.

Our 10 public packages are Apache-2.0; every tarball carries root LICENSE/NOTICE.
Third-party dependencies retain their own licenses (see generated SBOM and their
package license files); do not label all dependencies Apache-2.0. Source maps in
dist and intended schema/benchmark/conformance assets are included; source tests,
private documents, secrets and native Xberg installation are outside the ordinary
consumer proof. Local probes do not certify non-local platforms or live services.
SBOM entries for optional native binaries not installed on the current OS can
have unresolved license metadata; check those platform distributions separately
before including them in a release/legal attestation. Ordinary consumer adoption
above excludes the native adapter.

## Limited work before a real release

Review the local follow-up, then obtain separate authorization to push/review/merge.
Choose a new unused lockstep package version; keep frozen schema and suite versions
unless their separate contracts legitimately change. Build one canonical artifact,
run the exact-SHA full release gate and consumer/native proofs, review SBOM/legal
content and execute the existing staged OIDC release workflow with human 2FA.
Registry verification and any tag/GitHub Release need their own approved step.
No release/control-plane mutation is part of this local verification task.
