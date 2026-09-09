# @actionmanifest/exporters

Local file exporters: JSON and RFC 5545 iCalendar (VEVENT/VTODO).
**Verified-only by default** — the default policy exports only Actions whose
per-Action receipt passed; `status=verified` alone is never enough. Core
never writes to Google Calendar or any other app; exporters emit local files
only.

> **Release status:** release-candidate preparation — not yet published to
> npm. First release: `0.9.0-rc.1`.

```bash
npm install @actionmanifest/exporters  # once published
```

Requires Node.js >= 20.

## Usage

```ts
import { exportIcs, exportJson, selectExportableActions } from "@actionmanifest/exporters";

const ics = exportIcs(manifest);                          // throws ExportError on manifest-level fatal
const icsFixed = exportIcs(manifest, { now: new Date() }); // injectable clock → deterministic DTSTAMP
const json = exportJson(manifest);                        // schema-valid manifest JSON
const all = exportJson(manifest, { include: "all" });     // opt-in: include unverified
```

## Guarantees

- RFC 5545 byte-level conformance: UTF-8 octet-aware folding (≤ 75 octets),
  CRLF-only, injection-safe TEXT escaping, strict calendar dates.
- Conditional temporals (rain dates) never become `DTSTART`/`DUE`.
- UIDs are opaque hashes derived from source + action identity — stable
  across documents, no raw source leakage.

## Links

- Repository: <https://github.com/hello-ai-company/ActionManifest> (this
  package: `packages/exporters`)
- Standards: [docs/STANDARDS.md](../../docs/STANDARDS.md)

Apache-2.0.
