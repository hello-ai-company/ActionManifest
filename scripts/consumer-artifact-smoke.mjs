#!/usr/bin/env node
/**
 * Node 20 consumer proof against canonical tarballs (npm only; no pnpm).
 *
 * Installs every public package EXCEPT @actionmanifest/adapter-xberg from
 * local file: tarballs, using a fresh temp npm cache and --prefer-online.
 * Never mutates the user/global npm cache.
 *
 * Then: library imports, `actionman --version`, conformance 65/65.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXCLUDE = new Set(["@actionmanifest/adapter-xberg"]);
const EXPECTED_CONFORMANCE = 65;

function fail(message) {
  console.error(`consumer-artifact-smoke FAIL: ${message}`);
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

function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout || "").trim()}`);
  }
  return r.stdout || "";
}

function main() {
  if (process.version.startsWith("v20") === false && process.env.CONSUMER_SMOKE_ALLOW_OTHER_NODE !== "1") {
    console.log(`consumer-artifact-smoke: running on ${process.version} (Release Check gate uses Node 20)`);
  }
  const args = parseArgs(process.argv.slice(2));
  if (!args.artifacts && !args.registry) fail("usage: consumer-artifact-smoke.mjs --artifacts <dir> | --registry --version <ver>");

  const work = mkdtempSync(join(tmpdir(), "am-node20-consumer-"));
  const cache = mkdtempSync(join(tmpdir(), "am-npm-cache-"));
  const env = {
    ...process.env,
    npm_config_cache: cache,
    npm_config_userconfig: "/dev/null",
    npm_config_globalconfig: "/dev/null",
  };
  delete env.NPM_TOKEN;
  delete env.NODE_AUTH_TOKEN;

  try {
    const deps = {};
    if (args.registry) {
      if (!args.version) fail("--registry requires --version");
      for (const name of [
        "@actionmanifest/schema",
        "@actionmanifest/core",
        "@actionmanifest/temporal",
        "@actionmanifest/adapters",
        "@actionmanifest/extractor",
        "@actionmanifest/verifier",
        "@actionmanifest/exporters",
        "@actionmanifest/consumer",
        "@actionmanifest/cli",
      ]) {
        deps[name] = args.version;
      }
    } else {
      const root = locateRoot(resolve(args.artifacts));
      const manifest = JSON.parse(readFileSync(join(root, "release-manifest.json"), "utf8"));
      for (const p of manifest.packages) {
        if (EXCLUDE.has(p.name)) continue;
        const tgz = join(root, p.tarball);
        if (!existsSync(tgz)) fail(`tarball missing: ${tgz}`);
        deps[p.name] = `file:${tgz}`;
      }
      if (deps["@actionmanifest/adapter-xberg"]) {
        fail("adapter-xberg must be excluded from the Node 20 consumer smoke");
      }
    }

    writeFileSync(
      join(work, "package.json"),
      JSON.stringify(
        {
          name: "am-node20-consumer",
          private: true,
          type: "module",
          dependencies: deps,
          overrides: deps,
        },
        null,
        2,
      ),
    );

    console.log("consumer-artifact-smoke — npm install --prefer-online (fresh temp cache)…");
    run("npm", ["install", "--prefer-online", "--ignore-scripts", "--no-fund", "--no-audit"], work, env);

    if (existsSync(join(work, "node_modules", "@xberg-io"))) {
      fail("Node 20 consumer pulled @xberg-io/* — adapter-xberg must stay excluded");
    }
    if (existsSync(join(work, "node_modules", "@actionmanifest", "adapter-xberg"))) {
      fail("adapter-xberg was installed into the Node 20 consumer tree");
    }

    const importer = `
      const names = ${JSON.stringify(Object.keys(deps).filter((n) => n !== "@actionmanifest/cli"))};
      for (const n of names) {
        const m = await import(n);
        if (!m) throw new Error("empty import " + n);
        console.log("import-ok", n);
      }
    `;
    writeFileSync(join(work, "import-all.mjs"), importer);
    run("node", ["import-all.mjs"], work, env);

    const bin = join(work, "node_modules", ".bin", "actionman");
    if (!existsSync(bin)) fail("actionman bin missing after install");
    const versionOut = run(bin, ["--version"], work, env).trim();
    console.log(`  actionman --version → ${versionOut}`);

    const conf = spawnSync(bin, ["conformance", "--json"], {
      cwd: work,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    if (conf.status !== 0) fail(`conformance failed: ${conf.stderr || conf.stdout}`);
    const report = JSON.parse(conf.stdout);
    if (
      report.result !== "conformant" ||
      report.totals?.passed !== report.totals?.total ||
      report.totals?.total !== EXPECTED_CONFORMANCE
    ) {
      fail(
        `conformance not 65/65 (got ${report.totals?.passed}/${report.totals?.total}, result=${report.result})`,
      );
    }
    console.log(`consumer-artifact-smoke PASS — imports + actionman ${versionOut} + conformance ${EXPECTED_CONFORMANCE}/${EXPECTED_CONFORMANCE}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
}

const invokedAs = process.argv[1];
const here = fileURLToPath(import.meta.url);
if (invokedAs && resolve(invokedAs) === here) {
  main();
}

export { EXCLUDE, EXPECTED_CONFORMANCE };
