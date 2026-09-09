/**
 * pack:check — offline packaging verification for ALL public packages.
 *
 * For every publishable package (9 libraries + the CLI):
 *   1. `pnpm pack` into a temp dir (local only; nothing is published).
 *   2. Assert the tarball contains dist (runtime + .d.ts), LICENSE + NOTICE,
 *      schema/conformance/benchmark assets where applicable, and no src/ or
 *      test artifacts (neither sources nor compiled *.test.js).
 *   3. Assert the packed package.json has valid exports/types/files/bin,
 *      release metadata (license, repository.directory, engines,
 *      publishConfig.access=public), and no leftover `workspace:` protocol.
 *   4. Extract ALL tarballs into a temp node_modules layout and run a runtime
 *      smoke script that imports every library and drives the full pipeline
 *      (adapter → extract → verify → consumer → exporters).
 *   5. Standalone consumer matrix: for EVERY library, install the tarball with
 *      exactly its declared dependencies (recursively, no monorepo hoisting)
 *      and prove `tsc --noEmit` + a runtime import both work.
 *   6. CLI install smoke: install the CLI tarball with a real package manager
 *      (pnpm, offline, internal deps redirected to the local tarballs) and
 *      prove the `actionman` bin shim runs from a foreign cwd — including the
 *      bundled conformance suite with no repo checkout.
 *
 * Fully offline: external deps resolve from the workspace pnpm store.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cliInstallSmoke } from "./cli-install-smoke.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));

type PackageKind = "library" | "cli";

interface PublicPackage {
  name: string;
  dir: string;
  kind: PackageKind;
  /** Expected `engines.node` in the packed manifest. */
  node: string;
}

const LIBRARIES: PublicPackage[] = [
  { name: "schema", dir: "packages/schema", kind: "library", node: ">=20" },
  { name: "core", dir: "packages/core", kind: "library", node: ">=20" },
  { name: "temporal", dir: "packages/temporal", kind: "library", node: ">=20" },
  { name: "adapters", dir: "packages/adapters", kind: "library", node: ">=20" },
  { name: "extractor", dir: "packages/extractor", kind: "library", node: ">=20" },
  { name: "verifier", dir: "packages/verifier", kind: "library", node: ">=20" },
  { name: "exporters", dir: "packages/exporters", kind: "library", node: ">=20" },
  { name: "consumer", dir: "packages/consumer", kind: "library", node: ">=20" },
  { name: "adapter-xberg", dir: "packages/adapter-xberg", kind: "library", node: ">=22" },
];
const CLI: PublicPackage = { name: "cli", dir: "apps/cli", kind: "cli", node: ">=20" };
const PUBLIC_PACKAGES: PublicPackage[] = [...LIBRARIES, CLI];

/** Packages that are allowed to depend on the native Xberg binding. */
const XBERG_ALLOWED_PACKAGES = new Set(["adapter-xberg"]);

const REQUIRED_ENTRIES: Record<string, string[]> = {
  schema: [
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/schemas/v0.1/action-manifest.schema.json",
    "package/schemas/v0.2/action-manifest.schema.json",
    "package/schemas/canonical-document.schema.json",
    "package/LICENSE",
    "package/NOTICE",
  ],
  core: ["package/dist/index.js", "package/dist/index.d.ts", "package/LICENSE", "package/NOTICE"],
  temporal: ["package/dist/index.js", "package/dist/index.d.ts", "package/LICENSE", "package/NOTICE"],
  adapters: ["package/dist/index.js", "package/dist/index.d.ts", "package/LICENSE", "package/NOTICE"],
  extractor: ["package/dist/index.js", "package/dist/index.d.ts", "package/LICENSE", "package/NOTICE"],
  verifier: ["package/dist/index.js", "package/dist/index.d.ts", "package/LICENSE", "package/NOTICE"],
  exporters: ["package/dist/index.js", "package/dist/index.d.ts", "package/LICENSE", "package/NOTICE"],
  consumer: ["package/dist/index.js", "package/dist/index.d.ts", "package/LICENSE", "package/NOTICE"],
  "adapter-xberg": [
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/LICENSE",
    "package/NOTICE",
  ],
  cli: [
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/LICENSE",
    "package/NOTICE",
    // Bundled normative conformance suite (language-neutral vectors + meta-schemas).
    "package/conformance/manifest.json",
    "package/conformance/schema/suite-manifest.schema.json",
    "package/conformance/vectors/trust/passed-verified-001.json",
    "package/conformance/vectors/reference-serialization/golden/vevent-exact-001.ics",
    // Bundled synthetic benchmark corpus.
    "package/benchmark/fixtures/README.md",
  ],
};

const FORBIDDEN_PATTERNS = [
  /^package\/src\//,
  /\.test\.ts$/,
  /\.test\.js$/,
  /\.test\.d\.ts$/,
  /\.test\.js\.map$/,
  /\.test\.d\.ts\.map$/,
  /^package\/test\//,
];

function fail(message: string): never {
  console.error(`pack:check FAIL: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const work = mkdtempSync(join(tmpdir(), "actionmanifest-pack-"));
const tarballs = join(work, "tarballs");
const site = join(work, "consumer");
mkdirSync(tarballs);
mkdirSync(join(site, "node_modules", "@actionmanifest"), { recursive: true });

interface PackedPackage {
  dir: string;
  tgz: string;
  json: {
    name: string;
    version: string;
    type?: string;
    license?: string;
    sideEffects?: boolean;
    main?: string;
    types?: string;
    bin?: Record<string, string>;
    engines?: { node?: string };
    repository?: { type?: string; url?: string; directory?: string };
    homepage?: string;
    bugs?: string;
    publishConfig?: { access?: string };
    exports?: Record<string, unknown>;
    files?: string[];
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}
const packed = new Map<string, PackedPackage>();

/** Per-library standalone consumer snippets (runtime .mjs + typecheck .ts). */
const STANDALONE_SNIPPETS: Record<string, { ts: string; mjs: string }> = {
  schema: {
    ts: `import { actionManifestSchemasByVersion, SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS } from "@actionmanifest/schema";
const v: "0.2.0" = SCHEMA_VERSION;
if (!SUPPORTED_SCHEMA_VERSIONS.includes(v)) throw new Error("versions missing");
if (!actionManifestSchemasByVersion["0.1.0"] || !actionManifestSchemasByVersion["0.2.0"]) throw new Error("schema assets missing");
`,
    mjs: `import { actionManifestSchemasByVersion, SCHEMA_VERSION } from "@actionmanifest/schema";
if (SCHEMA_VERSION !== "0.2.0") throw new Error("SCHEMA_VERSION wrong");
if (!actionManifestSchemasByVersion["0.2.0"]) throw new Error("schema assets missing");
console.log("STANDALONE-OK");
`,
  },
  core: {
    ts: `import { validateActionManifest, assertCanonicalDocument, ensureSourceHash, evaluateActionTrust } from "@actionmanifest/core";
const doc = assertCanonicalDocument(ensureSourceHash({ id: "d1", text: "hello" }));
const manifest = validateActionManifest({ schema_version: "0.2.0", source: { id: "d1" }, actions: [] });
const trust = evaluateActionTrust({ id: "a1", kind: "event", title: "t", modality: "required", actor: { certainty: "unknown" }, temporal: { type: "unknown", raw_text: "不明" }, evidence: [{ source_id: "d1", text: "q" }], inference: "explicit", status: "proposed" }, undefined);
if (doc.id !== "d1" || manifest.schema_version !== "0.2.0" || trust.ready) throw new Error("core surface wrong");
`,
    mjs: `import { validateActionManifest, assertCanonicalDocument, ensureSourceHash } from "@actionmanifest/core";
const doc = assertCanonicalDocument(ensureSourceHash({ id: "d1", text: "hello" }));
const manifest = validateActionManifest({ schema_version: "0.2.0", source: { id: "d1" }, actions: [] });
if (doc.id !== "d1" || manifest.schema_version !== "0.2.0") throw new Error("core wrong");
console.log("STANDALONE-OK");
`,
  },
  temporal: {
    ts: `import { parseTemporals, reiwaToGregorian, primaryTemporal, detectModality } from "@actionmanifest/temporal";
if (reiwaToGregorian(8) !== 2026) throw new Error("era conversion wrong");
const hits = parseTemporals("令和8年10月15日に提出してください。");
const primary = primaryTemporal("令和8年10月15日に提出してください。");
if (hits.length === 0 || !primary) throw new Error("temporal parse wrong");
if (detectModality("必ず提出してください").modality !== "required") throw new Error("modality wrong");
`,
    mjs: `import { parseTemporals, reiwaToGregorian } from "@actionmanifest/temporal";
if (reiwaToGregorian(8) !== 2026) throw new Error("era conversion wrong");
if (parseTemporals("令和8年10月15日に提出してください。").length === 0) throw new Error("temporal parse wrong");
console.log("STANDALONE-OK");
`,
  },
  adapters: {
    ts: `import { PlainTextAdapter, DoclingAdapter, resolveAdapter, type DocumentAdapter } from "@actionmanifest/adapters";
const adapter: DocumentAdapter = new PlainTextAdapter();
const doc = await adapter.toCanonical({ kind: "text", id: "d1", text: "hello" });
if (doc.id !== "d1") throw new Error("plain text adapter wrong");
if (typeof DoclingAdapter !== "function" || typeof resolveAdapter !== "function") throw new Error("adapters surface missing");
`,
    mjs: `import { PlainTextAdapter, DoclingAdapter } from "@actionmanifest/adapters";
const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id: "d1", text: "hello" });
if (doc.id !== "d1" || typeof DoclingAdapter !== "function") throw new Error("adapters wrong");
console.log("STANDALONE-OK");
`,
  },
  extractor: {
    ts: `import { ActionExtractor, DeterministicProvider, extractActions, extractDeterministically } from "@actionmanifest/extractor";
import { assertCanonicalDocument, ensureSourceHash } from "@actionmanifest/core";
const doc = assertCanonicalDocument(ensureSourceHash({ id: "d1", text: "2026年10月15日に遠足を実施します。" }));
const manifest = await extractActions(doc);
if (manifest.schema_version !== "0.2.0") throw new Error("extractor wrong");
if (typeof ActionExtractor !== "function" || typeof DeterministicProvider !== "function" || typeof extractDeterministically !== "function") throw new Error("extractor surface missing");
`,
    mjs: `import { extractActions } from "@actionmanifest/extractor";
import { assertCanonicalDocument, ensureSourceHash } from "@actionmanifest/core";
const doc = assertCanonicalDocument(ensureSourceHash({ id: "d1", text: "2026年10月15日に遠足を実施します。" }));
const manifest = await extractActions(doc);
if (manifest.schema_version !== "0.2.0") throw new Error("extractor wrong");
console.log("STANDALONE-OK");
`,
  },
  // verifier/exporters/consumer declare only @actionmanifest/core (+temporal):
  // the candidate manifest is built by hand — importing the extractor or
  // adapters here would be an undeclared dependency and MUST fail.
  verifier: {
    ts: `import { verifyManifest, verificationPassed } from "@actionmanifest/verifier";
import { assertCanonicalDocument, ensureSourceHash, validateActionManifest } from "@actionmanifest/core";
const doc = assertCanonicalDocument(ensureSourceHash({ id: "d1", text: "2026年10月15日に秋の遠足を実施します。" }));
const candidate = validateActionManifest({
  schema_version: "0.2.0",
  source: { id: "d1" },
  actions: [{
    id: "act_001",
    kind: "event",
    title: "秋の遠足を実施する",
    modality: "required",
    actor: { certainty: "unknown" },
    temporal: { type: "exact", date: "2026-10-15", raw_text: "2026年10月15日" },
    evidence: [{ source_id: "d1", text: "2026年10月15日に秋の遠足を実施します。" }],
    inference: "explicit",
    status: "proposed",
  }],
});
const { flags } = verifyManifest(candidate, doc);
if (!verificationPassed(flags)) throw new Error("verifier wrong: " + JSON.stringify(flags.issues));
`,
    mjs: `import { verifyManifest, verificationPassed } from "@actionmanifest/verifier";
import { assertCanonicalDocument, ensureSourceHash, validateActionManifest } from "@actionmanifest/core";
const doc = assertCanonicalDocument(ensureSourceHash({ id: "d1", text: "2026年10月15日に秋の遠足を実施します。" }));
const candidate = validateActionManifest({
  schema_version: "0.2.0",
  source: { id: "d1" },
  actions: [{
    id: "act_001",
    kind: "event",
    title: "秋の遠足を実施する",
    modality: "required",
    actor: { certainty: "unknown" },
    temporal: { type: "exact", date: "2026-10-15", raw_text: "2026年10月15日" },
    evidence: [{ source_id: "d1", text: "2026年10月15日に秋の遠足を実施します。" }],
    inference: "explicit",
    status: "proposed",
  }],
});
const { flags } = verifyManifest(candidate, doc);
if (!verificationPassed(flags)) throw new Error("verifier wrong");
console.log("STANDALONE-OK");
`,
  },
  exporters: {
    ts: `import { exportIcs, exportJson, selectExportableActions, formatSummary } from "@actionmanifest/exporters";
import { validateActionManifest, type ActionManifest } from "@actionmanifest/core";
const manifest: ActionManifest = validateActionManifest({
  schema_version: "0.2.0",
  source: { id: "d1" },
  actions: [{
    id: "act_001",
    kind: "event",
    title: "秋の遠足を実施する",
    modality: "required",
    actor: { certainty: "unknown" },
    temporal: { type: "exact", date: "2026-10-15", raw_text: "2026年10月15日" },
    evidence: [{ source_id: "d1", text: "2026年10月15日に秋の遠足を実施します。" }],
    inference: "explicit",
    status: "verified",
  }],
  receipt: {
    extraction: { provider: "test", model: "none", extractor_version: "0", schema_version: "0.2.0", created_at: "2026-01-01T00:00:00.000Z" },
    verification: {
      evidence_supported: true, temporal_supported: true, actor_supported: true, modality_supported: true,
      source_hash_matched: true, negation_conflict: false, page_refs_valid: true, passed: true,
      actions: [{ action_id: "act_001", passed: true, evidence_supported: true, temporal_supported: true, actor_supported: true, modality_supported: true, negation_conflict: false, page_refs_valid: true, issues: [] }],
    },
  },
});
const ics = exportIcs(manifest, { now: new Date("2026-01-01T00:00:00.000Z") });
if (!ics.includes("DTSTART;VALUE=DATE:20261015") || selectExportableActions(manifest).length !== 1) throw new Error("exporters wrong");
if (!JSON.parse(exportJson(manifest)) || typeof formatSummary(manifest) !== "string") throw new Error("exporters surface wrong");
`,
    mjs: `import { exportIcs, selectExportableActions } from "@actionmanifest/exporters";
import { validateActionManifest } from "@actionmanifest/core";
const manifest = validateActionManifest({
  schema_version: "0.2.0",
  source: { id: "d1" },
  actions: [{
    id: "act_001", kind: "event", title: "秋の遠足を実施する", modality: "required",
    actor: { certainty: "unknown" },
    temporal: { type: "exact", date: "2026-10-15", raw_text: "2026年10月15日" },
    evidence: [{ source_id: "d1", text: "2026年10月15日に秋の遠足を実施します。" }],
    inference: "explicit", status: "verified",
  }],
  receipt: {
    extraction: { provider: "test", model: "none", extractor_version: "0", schema_version: "0.2.0", created_at: "2026-01-01T00:00:00.000Z" },
    verification: {
      evidence_supported: true, temporal_supported: true, actor_supported: true, modality_supported: true,
      source_hash_matched: true, negation_conflict: false, page_refs_valid: true, passed: true,
      actions: [{ action_id: "act_001", passed: true, evidence_supported: true, temporal_supported: true, actor_supported: true, modality_supported: true, negation_conflict: false, page_refs_valid: true, issues: [] }],
    },
  },
});
if (selectExportableActions(manifest).length !== 1) throw new Error("export policy wrong");
if (!exportIcs(manifest, { now: new Date("2026-01-01T00:00:00.000Z") }).includes("DTSTART;VALUE=DATE:20261015")) throw new Error("exporters wrong");
console.log("STANDALONE-OK");
`,
  },
  consumer: {
    ts: `import { classifyManifest, readyActions, CONSUMABLE_STATUSES, manifestFatalReasons } from "@actionmanifest/consumer";
import { validateActionManifest } from "@actionmanifest/core";
const manifest = validateActionManifest({
  schema_version: "0.2.0",
  source: { id: "d1" },
  actions: [{
    id: "act_001", kind: "event", title: "秋の遠足を実施する", modality: "required",
    actor: { certainty: "unknown" },
    temporal: { type: "exact", date: "2026-10-15", raw_text: "2026年10月15日" },
    evidence: [{ source_id: "d1", text: "2026年10月15日に秋の遠足を実施します。" }],
    inference: "explicit", status: "verified",
  }],
  receipt: {
    extraction: { provider: "test", model: "none", extractor_version: "0", schema_version: "0.2.0", created_at: "2026-01-01T00:00:00.000Z" },
    verification: {
      evidence_supported: true, temporal_supported: true, actor_supported: true, modality_supported: true,
      source_hash_matched: true, negation_conflict: false, page_refs_valid: true, passed: true,
      actions: [{ action_id: "act_001", passed: true, evidence_supported: true, temporal_supported: true, actor_supported: true, modality_supported: true, negation_conflict: false, page_refs_valid: true, issues: [] }],
    },
  },
});
const report = classifyManifest(manifest);
if (report.counts.ready !== 1 || readyActions(manifest).length !== 1) throw new Error("consumer wrong");
if (!Array.isArray(CONSUMABLE_STATUSES) || typeof manifestFatalReasons !== "function") throw new Error("consumer surface wrong");
`,
    mjs: `import { classifyManifest } from "@actionmanifest/consumer";
import { validateActionManifest } from "@actionmanifest/core";
const manifest = validateActionManifest({
  schema_version: "0.2.0",
  source: { id: "d1" },
  actions: [{
    id: "act_001", kind: "event", title: "秋の遠足を実施する", modality: "required",
    actor: { certainty: "unknown" },
    temporal: { type: "exact", date: "2026-10-15", raw_text: "2026年10月15日" },
    evidence: [{ source_id: "d1", text: "2026年10月15日に秋の遠足を実施します。" }],
    inference: "explicit", status: "verified",
  }],
  receipt: {
    extraction: { provider: "test", model: "none", extractor_version: "0", schema_version: "0.2.0", created_at: "2026-01-01T00:00:00.000Z" },
    verification: {
      evidence_supported: true, temporal_supported: true, actor_supported: true, modality_supported: true,
      source_hash_matched: true, negation_conflict: false, page_refs_valid: true, passed: true,
      actions: [{ action_id: "act_001", passed: true, evidence_supported: true, temporal_supported: true, actor_supported: true, modality_supported: true, negation_conflict: false, page_refs_valid: true, issues: [] }],
    },
  },
});
if (classifyManifest(manifest).counts.ready !== 1) throw new Error("consumer wrong");
console.log("STANDALONE-OK");
`,
  },
  "adapter-xberg": {
    ts: `import { XbergAdapter, mapXbergResultToCanonical, type XbergAdapterInput } from "@actionmanifest/adapter-xberg";
const adapter = new XbergAdapter();
const input: XbergAdapterInput = { kind: "xberg-result", sourceId: "doc-1", payload: { results: [{ content: "hello", mimeType: "text/plain" }], errors: [] } };
if (!adapter.canHandle(input)) throw new Error("xberg canHandle wrong");
const doc = mapXbergResultToCanonical(input.payload, { sourceId: "doc-1" });
if (doc.text !== "hello" || typeof adapter.toCanonical !== "function") throw new Error("xberg adapter wrong");
`,
    mjs: `import { XbergAdapter, mapXbergResultToCanonical } from "@actionmanifest/adapter-xberg";
const doc = mapXbergResultToCanonical(
  { results: [{ content: "hello", mimeType: "text/plain" }], errors: [] },
  { sourceId: "doc-1" },
);
if (doc.text !== "hello") throw new Error("standalone mapper wrong");
if (typeof XbergAdapter !== "function") throw new Error("standalone adapter missing");
console.log("STANDALONE-OK");
`,
  },
};

try {
  const packedNames: string[] = [];

  for (const pkg of PUBLIC_PACKAGES) {
    const pkgDir = join(root, pkg.dir);
    run("pnpm", ["pack", "--pack-destination", tarballs], pkgDir);
    const tgz = readdirSync(tarballs).find((f) => f.includes(`actionmanifest-${pkg.name}-`) && f.endsWith(".tgz"));
    if (!tgz) fail(`pnpm pack produced no tarball for ${pkg.name}`);
    const tgzPath = join(tarballs, tgz);

    const listing = run("tar", ["-tzf", tgzPath], work).split("\n").filter(Boolean);
    for (const required of REQUIRED_ENTRIES[pkg.name] ?? []) {
      if (!listing.includes(required)) fail(`${pkg.name}: tarball missing ${required}`);
    }
    for (const entry of listing) {
      if (FORBIDDEN_PATTERNS.some((p) => p.test(entry))) {
        fail(`${pkg.name}: tarball contains forbidden entry ${entry}`);
      }
    }

    const extractDir = join(work, "extract", pkg.name);
    mkdirSync(extractDir, { recursive: true });
    run("tar", ["-xzf", tgzPath, "-C", extractDir], work);
    const packedJson = JSON.parse(readFileSync(join(extractDir, "package", "package.json"), "utf8")) as PackedPackage["json"];

    // ---- identity & release metadata ----
    if (packedJson.name !== `@actionmanifest/${pkg.name}`) fail(`${pkg.name}: unexpected name ${packedJson.name}`);
    if (!packedJson.version) fail(`${pkg.name}: missing version`);
    if (packedJson.type !== "module") fail(`${pkg.name}: type must be module`);
    if (packedJson.license !== "Apache-2.0") fail(`${pkg.name}: license must be Apache-2.0`);
    if (packedJson.publishConfig?.access !== "public") {
      fail(`${pkg.name}: publishConfig.access must be "public" (scoped packages default to restricted)`);
    }
    if (packedJson.engines?.node !== pkg.node) {
      fail(`${pkg.name}: engines.node must be "${pkg.node}", got ${JSON.stringify(packedJson.engines?.node)}`);
    }
    if (packedJson.repository?.type !== "git" || !packedJson.repository.url?.includes("hello-ai-company/ActionManifest")) {
      fail(`${pkg.name}: repository.url must point at hello-ai-company/ActionManifest`);
    }
    if (packedJson.repository.directory !== pkg.dir) {
      fail(`${pkg.name}: repository.directory must be "${pkg.dir}", got ${JSON.stringify(packedJson.repository.directory)}`);
    }
    if (!packedJson.homepage || !packedJson.bugs) fail(`${pkg.name}: homepage and bugs are required`);

    // ---- entry points ----
    if (!packedJson.exports?.["."]) fail(`${pkg.name}: exports["."] missing`);
    if (!packedJson.types && !(packedJson.exports["."] as { types?: string }).types) {
      fail(`${pkg.name}: type declarations not exposed`);
    }
    if (!Array.isArray(packedJson.files) || !packedJson.files.includes("dist")) {
      fail(`${pkg.name}: files must include dist`);
    }
    if (pkg.kind === "library" && packedJson.sideEffects !== false) {
      fail(`${pkg.name}: libraries must declare "sideEffects": false for tree-shaking`);
    }
    if (pkg.kind === "cli") {
      if (packedJson.sideEffects === false) {
        fail("cli: must NOT declare sideEffects:false (entry point executes on import)");
      }
      if (packedJson.bin?.["actionman"] !== "./dist/index.js") {
        fail(`cli: bin.actionman must be ./dist/index.js, got ${JSON.stringify(packedJson.bin)}`);
      }
      if (packedJson.main !== "./dist/index.js" || packedJson.types !== "./dist/index.d.ts") {
        fail("cli: main/types must point at ./dist/index.js / ./dist/index.d.ts");
      }
      const binSource = readFileSync(join(extractDir, "package", "dist", "index.js"), "utf8");
      if (!binSource.startsWith("#!/usr/bin/env node")) {
        fail("cli: dist/index.js must keep the #!/usr/bin/env node shebang");
      }
    }
    for (const [dep, range] of Object.entries(packedJson.dependencies ?? {})) {
      if (range.includes("workspace:")) fail(`${pkg.name}: dependency ${dep} still uses workspace: protocol`);
      // Native dependency containment: only the Xberg adapter package may
      // depend on @xberg-io/* — core and the other packages stay parser-free.
      if (dep.startsWith("@xberg-io/") && !XBERG_ALLOWED_PACKAGES.has(pkg.name)) {
        fail(`${pkg.name}: Xberg dependency leaked into a non-adapter package (${dep})`);
      }
      // CTO Round-1: the native Xberg binding must be an EXACT pin — no
      // caret/tilde/range. The adapter contract is verified against the
      // installed 1.1.3 types; a range would silently accept future native
      // releases at install time (ADR 0007).
      if (dep === "@xberg-io/xberg" && !/^\d+\.\d+\.\d+$/.test(range)) {
        fail(`${pkg.name}: @xberg-io/xberg must be an exact pin (e.g. 1.1.3), got ${JSON.stringify(range)}`);
      }
      // The CLI must stay Node 20 capable: it must not pull the native
      // Xberg adapter (Node >= 22) as a default dependency.
      if (pkg.kind === "cli" && dep === "@actionmanifest/adapter-xberg") {
        fail("cli: must not depend on @actionmanifest/adapter-xberg (keeps CLI Node 20 capable)");
      }
    }
    // exports targets must exist inside the tarball
    const dot = packedJson.exports["."] as { import?: string; types?: string };
    for (const target of [dot.import, dot.types]) {
      if (target && !listing.includes(`package/${target.replace(/^\.\//, "")}`)) {
        fail(`${pkg.name}: exports target ${target} not present in tarball`);
      }
    }

    // Stage libraries into the smoke-test node_modules layout.
    if (pkg.kind === "library") {
      cpSync(join(extractDir, "package"), join(site, "node_modules", "@actionmanifest", pkg.name), {
        recursive: true,
      });
    }
    packedNames.push(pkg.name);
    packed.set(pkg.name, { dir: join(extractDir, "package"), tgz: tgzPath, json: packedJson });
    console.log(`  ✓ @actionmanifest/${pkg.name} (${tgz})`);
  }

  // External runtime deps of the packed packages, resolved from the workspace
  // store and symlinked (offline).
  for (const dep of ["ajv", "ajv-formats"]) {
    const depPkgJson = require.resolve(`${dep}/package.json`);
    const target = join(site, "node_modules", dep);
    if (!existsSync(target)) symlinkSync(dirname(depPkgJson), target, "dir");
  }

  writeFileSync(join(site, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  writeFileSync(
    join(site, "smoke.mjs"),
    `import { actionManifestSchemasByVersion } from "@actionmanifest/schema";
import { validateActionManifest } from "@actionmanifest/core";
import { PlainTextAdapter, DoclingAdapter } from "@actionmanifest/adapters";
import { extractActions } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";
import { classifyManifest } from "@actionmanifest/consumer";
import { exportIcs, exportJson } from "@actionmanifest/exporters";
import { mapXbergResultToCanonical, XbergAdapter } from "@actionmanifest/adapter-xberg";

if (!actionManifestSchemasByVersion["0.2.0"]) throw new Error("schema assets missing");
// Xberg adapter: pure mapping layer works from the packed artifact WITHOUT
// loading the native binding (dynamic import in the runtime bridge).
const xdoc = mapXbergResultToCanonical(
  { results: [{ content: "pack smoke", mimeType: "text/plain" }], errors: [] },
  { sourceId: "pack-smoke-xberg" },
);
if (xdoc.text !== "pack smoke") throw new Error("xberg mapper wrong");
if (typeof XbergAdapter !== "function") throw new Error("xberg adapter missing");
const doc = await new PlainTextAdapter().toCanonical({
  kind: "text",
  id: "pack-smoke",
  text: "令和8年10月15日に秋の遠足を実施します。",
});
const candidate = await extractActions(doc);
const { manifest, flags } = verifyManifest(candidate, doc);
if (!flags.passed) throw new Error("verification did not pass");
if (classifyManifest(manifest).counts.ready !== 1) throw new Error("consumer classification wrong");
if (!exportIcs(manifest).includes("DTSTART;VALUE=DATE:20261015")) throw new Error("ics wrong");
validateActionManifest(JSON.parse(exportJson(manifest)));
if (typeof DoclingAdapter !== "function") throw new Error("docling adapter missing");
console.log("PACK-SMOKE-OK");
`,
    "utf8",
  );

  const out = run("node", ["smoke.mjs"], site);
  if (!out.includes("PACK-SMOKE-OK")) fail("runtime smoke did not complete");

  // Every public type reference in shipped .d.ts files must be declared in
  // the package's own dependencies — a monorepo can accidentally resolve
  // undeclared packages via hoisting, hiding the leak from consumers.
  checkDeclaredTypeDeps(packed);

  // Standalone consumer matrix: every library installed from its tarball with
  // declared dependencies only, then typechecked AND executed.
  for (const pkg of LIBRARIES) {
    standaloneConsumerCheck(packed, pkg.name);
  }

  // CLI: real package-manager install of the tarball in a fresh project,
  // then bin-shim smoke from a foreign cwd (no repository checkout).
  const cliInfo = packed.get("cli");
  if (!cliInfo) fail("cli was not packed");
  cliInstallSmoke({
    cliTarball: cliInfo.tgz,
    expectedVersion: cliInfo.json.version,
    libraryTarballs: new Map(LIBRARIES.map((p) => [p.name, packed.get(p.name)!.tgz])),
    expectedConformanceTotal: 65,
  });

  console.log(
    `pack:check PASS (${packedNames.length} packages packed, verified, runtime-smoked, type-deps declared, standalone matrix + CLI install smoke OK)`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** Scan shipped .d.ts for external package references and require them declared. */
function checkDeclaredTypeDeps(packed: Map<string, PackedPackage>): void {
  const refPattern = /(?:from|import)\s*\(?\s*["'](@[a-z0-9-]+\/[a-z0-9-]+)["']/gi;
  for (const [pkg, info] of packed) {
    const declared = new Set([
      ...Object.keys(info.json.dependencies ?? {}),
      ...Object.keys(info.json.peerDependencies ?? {}),
    ]);
    const distDir = join(info.dir, "dist");
    if (!existsSync(distDir)) continue;
    const stack = [distDir];
    const files: string[] = [];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(p);
        else if (entry.name.endsWith(".d.ts")) files.push(p);
      }
    }
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(refPattern)) {
        const ref = match[1]!;
        if (ref.startsWith("@actionmanifest/") && ref === info.json.name) continue;
        if (!declared.has(ref)) {
          fail(
            `${pkg}: ${file.slice(file.indexOf("dist"))} references "${ref}" in its public types, but it is not declared in dependencies/peerDependencies`,
          );
        }
      }
    }
  }
}

/**
 * Prove one packed library works standalone: extract the tarball plus exactly
 * its declared dependencies (recursively), then typecheck and run a tiny
 * consumer. No workspace hoisting involved.
 */
function standaloneConsumerCheck(packed: Map<string, PackedPackage>, target: string): void {
  const info = packed.get(target);
  if (!info) fail(`${target} was not packed`);
  const snippet = STANDALONE_SNIPPETS[target];
  if (!snippet) fail(`no standalone consumer snippet defined for ${target}`);

  const standalone = join(work, "standalone", target);
  const modules = join(standalone, "node_modules");
  mkdirSync(join(modules, "@actionmanifest"), { recursive: true });

  const seen = new Set<string>();
  const install = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    if (name.startsWith("@actionmanifest/")) {
      const short = name.slice("@actionmanifest/".length);
      const dep = packed.get(short);
      if (!dep) fail(`${target}: undeclared internal dependency ${name}`);
      cpSync(dep.dir, join(modules, "@actionmanifest", short), { recursive: true });
      for (const d of Object.keys(dep.json.dependencies ?? {})) install(d);
    } else {
      // External dependency: link from the workspace store (offline).
      // Note: some packages (e.g. Xberg) do not export ./package.json, so
      // resolve the directory directly instead of require.resolve on it.
      const direct = join(root, "node_modules", name);
      let pkgDir: string | undefined;
      if (existsSync(join(direct, "package.json"))) {
        pkgDir = direct;
      } else {
        let dir = dirname(require.resolve(name));
        while (dir !== dirname(dir)) {
          if (existsSync(join(dir, "package.json"))) {
            pkgDir = dir;
            break;
          }
          dir = dirname(dir);
        }
      }
      if (!pkgDir) fail(`cannot resolve installed package dir for ${name}`);
      const dest = join(modules, name);
      mkdirSync(dirname(dest), { recursive: true });
      if (!existsSync(dest)) symlinkSync(pkgDir, dest, "dir");
    }
  };
  for (const d of Object.keys(info.json.dependencies ?? {})) install(d);
  cpSync(info.dir, join(modules, "@actionmanifest", target), { recursive: true });

  writeFileSync(join(standalone, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  writeFileSync(
    join(standalone, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "nodenext",
        moduleResolution: "nodenext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["consumer.ts"],
    }),
    "utf8",
  );
  writeFileSync(join(standalone, "consumer.ts"), snippet.ts, "utf8");
  writeFileSync(join(standalone, "smoke.mjs"), snippet.mjs, "utf8");

  const tscBin = join(root, "node_modules", ".bin", "tsc");
  run(tscBin, ["--noEmit", "-p", "."], standalone);
  const smoke = run("node", ["smoke.mjs"], standalone);
  if (!smoke.includes("STANDALONE-OK")) fail(`${target}: standalone runtime smoke did not complete`);
  console.log(`  ✓ @actionmanifest/${target} standalone consumer (declared deps only): tsc + runtime OK`);
}
