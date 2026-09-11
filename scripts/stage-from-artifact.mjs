#!/usr/bin/env node
/**
 * Stage exact canonical tarballs via `npm stage publish`.
 * NEVER runs `npm publish` or `npm stage approve`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function fail(message) {
  console.error(`stage-from-artifact FAIL: ${message}`);
  process.exit(1);
}

function isPrerelease(version) {
  return version.includes("-");
}

function distTagForVersion(version) {
  return isPrerelease(version) ? "next" : "latest";
}

function locateRoot(start) {
  const candidates = [start, join(start, "release-artifacts")];
  for (const c of candidates) {
    if (existsSync(join(c, "release-manifest.json"))) return c;
  }
  fail(`release-manifest.json not found under ${start}`);
}

function main() {
  for (const tokenVar of ["NPM_TOKEN", "NODE_AUTH_TOKEN"]) {
    if (process.env[tokenVar]) fail(`${tokenVar} must not be present in the stage path`);
  }
  const artifacts = resolve(process.argv[2] || "release-artifacts");
  const forcedTag = process.argv.includes("--tag")
    ? process.argv[process.argv.indexOf("--tag") + 1]
    : undefined;
  const root = locateRoot(artifacts);
  const manifest = JSON.parse(readFileSync(join(root, "release-manifest.json"), "utf8"));
  const version = manifest.identity?.version || manifest.packages[0]?.version;
  if (!version) fail("manifest has no version");
  const expectedTag = distTagForVersion(version);
  if (forcedTag && forcedTag !== expectedTag) {
    fail(`refusing tag/version pairing: ${version} requires --tag ${expectedTag}, got ${forcedTag}`);
  }
  const tag = expectedTag;
  const order = manifest.publish_order;
  if (!Array.isArray(order) || order.length !== 10) fail("publish_order must list 10 packages");
  const byName = new Map(manifest.packages.map((p) => [p.name, p]));
  const staged = [];
  for (const name of order) {
    const entry = byName.get(name);
    if (!entry) fail(`unknown package ${name}`);
    const tgz = join(root, entry.tarball);
    if (!existsSync(tgz)) fail(`tarball missing: ${tgz}`);
    const args = [
      "stage",
      "publish",
      tgz,
      "--access",
      "public",
      "--tag",
      tag,
      "--registry",
      "https://registry.npmjs.org/",
    ];
    if (args.includes("approve") || args[1] === "publish" && args[0] !== "stage") {
      fail("internal: refusing a non-stage command");
    }
    console.log(`staging ${name}@${entry.version} from ${entry.tarball} (--tag ${tag})`);
    const r = spawnSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.status !== 0) {
      fail(`npm stage publish failed for ${name}: ${(r.stderr || r.stdout || "").trim()}`);
    }
    staged.push({
      name,
      version: entry.version,
      tarball: entry.tarball,
      sha256: entry.sha256,
      dist_tag: tag,
      stdout_tail: (r.stdout || "").trim().slice(-200),
    });
  }
  const evidence = {
    kind: "actionmanifest-stage-evidence",
    version,
    dist_tag: tag,
    git_sha: manifest.identity?.git_sha || manifest.git_sha || manifest.git?.head,
    git_tree: manifest.identity?.git_tree || manifest.git_tree,
    packages: staged,
    registry_writes: "npm stage publish only — no approve, no npm publish, no dist-tag mutation",
  };
  const evidencePath = join(root, "stage-evidence.json");
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(`stage-from-artifact PASS — ${staged.length} packages staged as --tag ${tag}`);
  console.log(`evidence: ${evidencePath}`);
  console.log("STOP: human 2FA `npm stage approve` is a later, out-of-band step. This job does not approve.");
}

main();
