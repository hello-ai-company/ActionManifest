#!/usr/bin/env node
/**
 * Node 22+ Xberg native smoke against canonical adapter-xberg tarball.
 *
 * Real native binding, synthetic local fixtures only (file + bytes).
 * Expected: 2/2 PASS. No network fetches of documents.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextEncoder } from "node:util";

const NOTICE = `保護者向け行事案内

令和8年10月15日に秋の遠足を実施します。
参加を希望する方は、10月5日までに参加確認票を提出してください。
当日は弁当、水筒、タオルを持参してください。
雨天の場合は10月22日に延期します。
`;

function fail(message) {
  console.error(`xberg-artifact-smoke FAIL: ${message}`);
  process.exit(1);
}

function locateRoot(start) {
  const candidates = [start, join(start, "release-artifacts")];
  for (const c of candidates) {
    if (existsSync(join(c, "release-manifest.json")) || existsSync(join(c, "tarballs"))) return c;
  }
  fail(`cannot locate artifact root under ${start}`);
}

function parseArgs(argv) {
  const out = { artifacts: "", version: "", registry: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--artifacts") out.artifacts = argv[++i];
    else if (argv[i] === "--version") out.version = argv[++i];
    else if (argv[i] === "--registry") out.registry = true;
  }
  return out;
}

function majorNode() {
  return Number(process.versions.node.split(".")[0]);
}

async function main() {
  if (majorNode() < 22) {
    fail(`adapter-xberg native smoke requires Node >= 22 (got ${process.version})`);
  }
  const args = parseArgs(process.argv.slice(2));
  if (!args.artifacts && !args.registry) fail("usage: xberg-artifact-smoke.mjs --artifacts <dir> | --registry --version <ver>");

  const work = mkdtempSync(join(tmpdir(), "am-xberg-smoke-"));
  const cache = mkdtempSync(join(tmpdir(), "am-npm-cache-"));
  const env = {
    ...process.env,
    npm_config_cache: cache,
  };
  delete env.NPM_TOKEN;
  delete env.NODE_AUTH_TOKEN;

  try {
    const deps = {};
    if (args.registry) {
      if (!args.version) fail("--registry requires --version");
      deps["@actionmanifest/adapter-xberg"] = args.version;
      deps["@actionmanifest/core"] = args.version;
      deps["@actionmanifest/adapters"] = args.version;
    } else {
      const root = locateRoot(resolve(args.artifacts));
      const manifest = JSON.parse(readFileSync(join(root, "release-manifest.json"), "utf8"));
      const wanted = new Set([
        "@actionmanifest/adapter-xberg",
        "@actionmanifest/core",
        "@actionmanifest/adapters",
        "@actionmanifest/schema",
      ]);
      for (const p of manifest.packages) {
        if (!wanted.has(p.name)) continue;
        const tgz = join(root, p.tarball);
        if (!existsSync(tgz)) fail(`tarball missing: ${tgz}`);
        deps[p.name] = `file:${tgz}`;
      }
      if (!deps["@actionmanifest/adapter-xberg"]) fail("adapter-xberg tarball missing from canonical artifact");
    }

    writeFileSync(
      join(work, "package.json"),
      JSON.stringify(
        {
          name: "am-xberg-smoke",
          private: true,
          type: "module",
          dependencies: deps,
          overrides: Object.fromEntries(
            Object.entries(deps).filter(([n]) => n.startsWith("@actionmanifest/")),
          ),
        },
        null,
        2,
      ),
    );

    console.log("xberg-artifact-smoke — npm install --prefer-online (fresh temp cache)…");
    const inst = spawnSync(
      "npm",
      ["install", "--prefer-online", "--no-fund", "--no-audit", "--cache", cache],
      { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env },
    );
    if (inst.status !== 0) fail(`npm install failed: ${inst.stderr || inst.stdout}`);

    const adapterEntry = join(work, "node_modules/@actionmanifest/adapter-xberg/dist/index.js");
    if (!existsSync(adapterEntry)) fail("adapter-xberg dist/index.js missing after install");
    const { XbergAdapter } = await import(pathToFileURL(adapterEntry).href);

    let passed = 0;
    const dir = mkdtempSync(join(tmpdir(), "xberg-fix-"));
    const path = join(dir, "notice.txt");
    writeFileSync(path, NOTICE, "utf8");

    const adapter = new XbergAdapter();
    const doc = await adapter.toCanonical({ kind: "xberg-uri", sourceId: "live-notice", uri: path });
    if (doc.id !== "live-notice") fail(`file fixture: unexpected id ${doc.id}`);
    if (!String(doc.text).includes("秋の遠足")) fail("file fixture: missing 秋の遠足");
    if (!String(doc.text).includes("10月5日までに参加確認票")) fail("file fixture: missing deadline text");
    if (!/^[a-f0-9]{64}$/.test(doc.sourceHash)) fail("file fixture: sourceHash not sha256");
    passed += 1;
    console.log("  ✓ 1/2 file fixture PASS");

    const bytesDoc = await adapter.toCanonical({
      kind: "xberg-bytes",
      sourceId: "live-bytes",
      bytes: new TextEncoder().encode(NOTICE),
      filename: "notice.txt",
      mimeType: "text/plain",
    });
    if (!String(bytesDoc.text).includes("雨天の場合は10月22日")) fail("bytes fixture: missing rain date");
    passed += 1;
    console.log("  ✓ 2/2 bytes fixture PASS");

    if (passed !== 2) fail(`expected 2/2 PASS, got ${passed}`);
    console.log("xberg-artifact-smoke PASS — 2/2 native synthetic fixtures");
    rmSync(dir, { recursive: true, force: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
}

const invokedAs = process.argv[1];
const here = fileURLToPath(import.meta.url);
if (invokedAs && resolve(invokedAs) === here) {
  main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
}
