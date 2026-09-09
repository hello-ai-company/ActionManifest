# @actionmanifest/adapter-xberg

Xberg reference adapter: `Xberg ExtractionResult → CanonicalDocument`. The
**optional** second parser that proves the CanonicalDocument boundary is
parser-independent. The native Xberg binding is isolated in this package —
no other `@actionmanifest/*` package depends on it (enforced by CI).

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`. Verified against `@xberg-io/xberg`
> **1.1.3 exactly** (pinned; see
> [ADR 0007](../../docs/adr/0007-release-versioning-and-supply-chain.md)).
>
> **Stability split (0.x):**
> - **Layer A — `mapXbergResultToCanonical`** is the *stable structural
>   mapper*: pure validation + mapping of a serialized `ExtractionResult`,
>   no native binding, no network. Normal 0.x policy.
> - **Layer B — `XbergAdapter` runtime bridge** is **experimental**
>   (`@experimental` in JSDoc): it dynamically imports the native NAPI
>   binding, requires Node >= 22, and its live behavior is covered by opt-in
>   integration tests (`pnpm xberg:integration`), not the default CI matrix.
>   The bridge API may change between 0.x minors.

```bash
npm install @actionmanifest/adapter-xberg   # once published — opt-in
```

Requires Node.js >= 22 (Xberg's own requirement; every other
ActionManifest package is >= 20).

## Two layers

```ts
// Layer A — pure mapping, no native binding, no network. Use this if you
// already ran Xberg yourself:
import { mapXbergResultToCanonical } from "@actionmanifest/adapter-xberg";
const doc = mapXbergResultToCanonical(serializedExtractionResult, { sourceId: "doc-1" });

// Layer B — runtime bridge; dynamically imports the native engine:
import { XbergAdapter } from "@actionmanifest/adapter-xberg";
const adapter = new XbergAdapter();
const doc2 = await adapter.toCanonical({ kind: "xberg-uri", sourceId: "doc-2", uri });
```

Remote URLs are never fetched unless you pass `allowRemote: true`.

## Contract notes

- Source identity is caller-supplied (`sourceId`); Xberg element/result ids
  are locators (`sourceReference`), never document identity.
- Pages map only when upstream provides per-page content; **bbox is omitted**
  (unknown coordinate system — unknown stays unknown).
- Multi-document results are rejected (`MULTIPLE_DOCUMENTS`).

Full mapping table: [docs/ADAPTER-XBERG.md](../../docs/ADAPTER-XBERG.md).

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `packages/adapter-xberg`)
- Parser independence proof: [docs/PARSER-INDEPENDENCE.md](../../docs/PARSER-INDEPENDENCE.md)

Apache-2.0.
