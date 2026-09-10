# @actionmanifest/adapters

Document adapters: **parse and normalize ONLY — never infer Actions.**
Ships the Plain Text reference adapter (working) and the Docling JSON
reference adapter (interface + fixtures). Third-party parsers implement the
generic `DocumentAdapter<I>` contract from their own packages.

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`.

```bash
npm install @actionmanifest/adapters   # once published
```

Requires Node.js >= 20.

## Usage

```ts
import { PlainTextAdapter, DoclingAdapter, resolveAdapter } from "@actionmanifest/adapters";

const doc = await new PlainTextAdapter().toCanonical({
  kind: "text",
  id: "notice-1",
  text,
});

// Docling (Python) runs upstream — pass export_to_dict() JSON:
const doclingDoc = await new DoclingAdapter().toCanonical({
  kind: "docling-json",
  sourceId: "notice-1",
  payload: doclingJson,
});
```

## Writing your own adapter

Implement `DocumentAdapter<YourInput>` in YOUR package; do not extend the
central `AdapterInput` union. Read
[docs/ADAPTER-AUTHOR-GUIDE.md](../../docs/ADAPTER-AUTHOR-GUIDE.md) — the
safety rules (stable source identity, deterministic hash, unknown stays
unknown, fail closed) are not negotiable.

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `packages/adapters`)
- Xberg reference adapter: `@actionmanifest/adapter-xberg` (optional,
  Node >= 22)

Apache-2.0.
