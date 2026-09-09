/**
 * Executable quick start — this file IS the README "Using ActionManifest as a
 * library" example. It is typechecked and executed in CI (`pnpm
 * docs:examples`), so the README can never drift from the real API.
 *
 * Deterministic: the default provider runs locally; no network, no API keys.
 *
 * When the packages are published, the same imports resolve from npm
 * (@actionmanifest/adapters, @actionmanifest/extractor, …). In this repo they
 * resolve to the sources via tsconfig paths.
 */
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { extractActions } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";
import { classifyManifest } from "@actionmanifest/consumer";
import { exportIcs, exportJson } from "@actionmanifest/exporters";
import { validateActionManifest } from "@actionmanifest/core";

const text =
  "令和8年10月15日に秋の遠足を実施します。雨天の場合は10月22日に延期します。当日は弁当を持参してください。";

// 1. Parse/normalize ONLY — adapters never infer Actions.
const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id: "notice-1", text });

// 2. Extract candidate Actions (deterministic provider by default).
const candidate = await extractActions(doc);

// 3. Verify per Action against the source document.
const { manifest, flags } = verifyManifest(candidate, doc);
if (!flags.passed) throw new Error("expected the golden notice to verify cleanly");

// 4. Apply the reference consumer policy: ready / review_required / blocked.
const report = classifyManifest(manifest);
if (report.counts.ready !== 2 || report.counts.blocked !== 0) {
  throw new Error(`unexpected classification: ${JSON.stringify(report.counts)}`);
}

// 5. Export — verified-only by default; conditional rain date never becomes DTSTART.
const ics = exportIcs(manifest);
if (!ics.includes("DTSTART;VALUE=DATE:20261015")) throw new Error("missing primary date");
if (ics.includes("20261022")) throw new Error("conditional alternative must not be executable");

// The exported JSON is still a schema-valid Action Manifest.
validateActionManifest(JSON.parse(exportJson(manifest)));

console.log(`library-quick-start OK: ${report.counts.ready} ready actions, ICS ${ics.length} bytes`);
