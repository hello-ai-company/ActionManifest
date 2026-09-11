/**
 * Full canonical release-artifact validation used by stage and local gates.
 * Network: none. Fail closed when expected identity is supplied but missing.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Must match PUBLIC_PACKAGE_NAMES in release-identity.ts (set equality). */
export const EXPECTED_PACKAGE_NAMES = Object.freeze([
  "@actionmanifest/schema",
  "@actionmanifest/core",
  "@actionmanifest/temporal",
  "@actionmanifest/adapters",
  "@actionmanifest/extractor",
  "@actionmanifest/verifier",
  "@actionmanifest/exporters",
  "@actionmanifest/consumer",
  "@actionmanifest/adapter-xberg",
  "@actionmanifest/cli",
]);

const PACKAGE_NAME_SET = new Set(EXPECTED_PACKAGE_NAMES);
const PACKAGE_NAME_RE = /^@actionmanifest\/[a-z0-9-]+$/;

/**
 * @param {string} filePath
 */
function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * @param {string} text
 */
export function parseSha256Sums(text) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) {
      throw new Error(`SHA256SUMS: malformed line: ${line}`);
    }
    map.set(m[2], m[1]);
  }
  return map;
}

/**
 * @param {{
 *   dir: string,
 *   expectedHead?: string,
 *   expectedVersion?: string,
 *   requireIdentity?: boolean,
 * }} opts
 */
export function validateCanonicalReleaseDir(opts) {
  if (!opts || typeof opts.dir !== "string" || !opts.dir) {
    throw new Error("validateCanonicalReleaseDir: dir is required");
  }
  const dir = opts.dir;
  const expectedHead = opts.expectedHead;
  const expectedVersion = opts.expectedVersion;
  const requireIdentity = opts.requireIdentity === true || Boolean(expectedHead);

  const manifestPath = join(dir, "release-manifest.json");
  const sumsPath = join(dir, "SHA256SUMS");
  const tarballDir = join(dir, "tarballs");

  if (!existsSync(manifestPath)) {
    throw new Error(`canonical artifact missing release-manifest.json under ${dir}`);
  }
  if (!existsSync(sumsPath)) {
    throw new Error(`canonical artifact missing SHA256SUMS under ${dir}`);
  }
  if (!existsSync(tarballDir)) {
    throw new Error(`canonical artifact missing tarballs/ under ${dir}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("release-manifest.json must be an object");
  }

  const identity = manifest.identity;
  if (requireIdentity && (identity == null || typeof identity !== "object")) {
    throw new Error(
      "FAIL: expectedHead supplied but canonical identity is missing",
    );
  }
  if (identity != null && typeof identity !== "object") {
    throw new Error("release-manifest identity must be an object when present");
  }

  if (identity) {
    if (typeof identity.git_sha !== "string" || !/^[0-9a-f]{40}$/.test(identity.git_sha)) {
      throw new Error("identity.git_sha must be a 40-char commit SHA");
    }
    if (typeof identity.git_tree !== "string" || !/^[0-9a-f]{40}$/.test(identity.git_tree)) {
      throw new Error("identity.git_tree must be a 40-char tree SHA");
    }
    if (typeof identity.version !== "string" || !identity.version) {
      throw new Error("identity.version is required");
    }
    if (identity.platform !== "linux") {
      throw new Error(`identity.platform must be linux, got ${String(identity.platform)}`);
    }
    if (identity.node_major !== 22 && identity.node_major !== "22") {
      throw new Error(`identity.node_major must be 22, got ${String(identity.node_major)}`);
    }
    if (identity.pnpm_version !== "11.23.0") {
      throw new Error(`identity.pnpm_version must be 11.23.0, got ${String(identity.pnpm_version)}`);
    }
    if (typeof identity.node_version === "string") {
      throw new Error(
        "identity must not include node_version (host patch is non-deterministic evidence)",
      );
    }
    if (expectedHead && identity.git_sha !== expectedHead) {
      throw new Error(
        `identity.git_sha ${identity.git_sha} !== expected HEAD ${expectedHead}`,
      );
    }
    if (expectedVersion && identity.version !== expectedVersion) {
      throw new Error(
        `identity.version ${identity.version} !== expected version ${expectedVersion}`,
      );
    }
  }

  const packages = manifest.packages;
  if (!Array.isArray(packages) || packages.length !== 10) {
    throw new Error(`canonical packages must be exactly 10, got ${packages?.length ?? 0}`);
  }

  const order = Array.isArray(manifest.publish_order) ? manifest.publish_order : [];
  if (order.length !== 10) {
    throw new Error(`publish_order must list 10 packages, got ${order.length}`);
  }
  if (new Set(order).size !== 10) {
    throw new Error("publish_order must contain 10 unique package names");
  }
  for (const name of order) {
    if (!PACKAGE_NAME_SET.has(name)) {
      throw new Error(`publish_order contains unexpected package ${name}`);
    }
  }
  for (const name of EXPECTED_PACKAGE_NAMES) {
    if (!order.includes(name)) {
      throw new Error(`publish_order missing expected package ${name}`);
    }
  }

  if (identity) {
    if (!Array.isArray(identity.packages)) {
      throw new Error("identity.packages is required and must be an array");
    }
    if (!Array.isArray(identity.publish_order)) {
      throw new Error("identity.publish_order is required and must be an array");
    }
    assertPublishOrderEqual(identity.publish_order, order);
    assertPackageRecordsEqual(identity.packages, packages);
  }

  const names = new Set();
  const sumsText = readFileSync(sumsPath, "utf8");
  const sums = parseSha256Sums(sumsText);
  if (sums.size !== 10) {
    throw new Error(`SHA256SUMS must list 10 tarballs, got ${sums.size}`);
  }

  const lockstepVersion = identity?.version ?? expectedVersion ?? requireLockstepVersion(packages);
  for (const entry of packages) {
    if (!entry || typeof entry !== "object") {
      throw new Error("package entry must be an object");
    }
    if (typeof entry.name !== "string" || !PACKAGE_NAME_RE.test(entry.name)) {
      throw new Error(`invalid package name: ${String(entry.name)}`);
    }
    if (!PACKAGE_NAME_SET.has(entry.name)) {
      throw new Error(`unexpected package name: ${entry.name}`);
    }
    if (names.has(entry.name)) {
      throw new Error(`duplicate package name: ${entry.name}`);
    }
    names.add(entry.name);
    if (typeof entry.tarball !== "string" || !entry.tarball.startsWith("tarballs/")) {
      throw new Error(`${entry.name}: tarball must be tarballs/<file>`);
    }
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`${entry.name}: sha256 must be 64 hex chars`);
    }
    if (typeof entry.version !== "string" || !entry.version) {
      throw new Error(`${entry.name}: version is required`);
    }
    if (entry.version !== lockstepVersion) {
      throw new Error(`${entry.name}: version ${entry.version} !== ${lockstepVersion}`);
    }
    if (identity && entry.version !== identity.version) {
      throw new Error(
        `${entry.name}: version ${entry.version} !== identity.version ${identity.version}`,
      );
    }
    if (expectedVersion && entry.version !== expectedVersion) {
      throw new Error(`${entry.name}: version ${entry.version} !== expected ${expectedVersion}`);
    }
    const abs = join(dir, entry.tarball);
    if (!existsSync(abs)) {
      throw new Error(`missing tarball ${entry.tarball}`);
    }
    const actual = sha256File(abs);
    if (actual !== entry.sha256) {
      throw new Error(`${entry.name}: tarball sha256 ${actual} !== manifest ${entry.sha256}`);
    }
    const listed = sums.get(entry.tarball);
    if (!listed) {
      throw new Error(`SHA256SUMS missing ${entry.tarball}`);
    }
    if (listed !== entry.sha256) {
      throw new Error(`SHA256SUMS ${entry.tarball} ${listed} !== manifest ${entry.sha256}`);
    }
  }

  if (names.size !== 10) {
    throw new Error(`expected 10 unique package names, got ${names.size}`);
  }
  for (const name of EXPECTED_PACKAGE_NAMES) {
    if (!names.has(name)) {
      throw new Error(`packages missing ${name}`);
    }
  }

  return { ok: true, identity: identity ?? null, packages: packages.length };
}

/**
 * @param {unknown[]} left
 * @param {unknown[]} right
 */
function assertPublishOrderEqual(left, right) {
  if (left.length !== right.length) {
    throw new Error(
      `identity.publish_order length ${left.length} !== publish_order length ${right.length}`,
    );
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      throw new Error(
        `identity.publish_order mismatch at ${i}: ${String(left[i])} !== ${String(right[i])}`,
      );
    }
  }
}

/**
 * @param {unknown[]} left
 * @param {unknown[]} right
 */
function assertPackageRecordsEqual(left, right) {
  if (left.length !== right.length) {
    throw new Error(
      `identity.packages length ${left.length} !== packages length ${right.length}`,
    );
  }
  const seen = new Set();
  for (let i = 0; i < left.length; i++) {
    const a = packageRecord(left[i], `identity.packages[${i}]`);
    const b = packageRecord(right[i], `packages[${i}]`);
    if (seen.has(a.name)) {
      throw new Error(`identity.packages duplicate ${a.name}`);
    }
    seen.add(a.name);
    for (const key of ["name", "version", "tarball", "sha256"]) {
      if (a[key] !== b[key]) {
        throw new Error(
          `identity.packages ${a.name} ${key} mismatch: ${String(a[key])} !== ${String(b[key])}`,
        );
      }
    }
  }
}

/**
 * @param {unknown} entry
 * @param {string} label
 */
function packageRecord(entry, label) {
  if (!entry || typeof entry !== "object") {
    throw new Error(`${label} must be an object`);
  }
  const rec = /** @type {Record<string, unknown>} */ (entry);
  if (typeof rec.name !== "string" || !rec.name) {
    throw new Error(`${label}.name is required`);
  }
  if (typeof rec.version !== "string" || !rec.version) {
    throw new Error(`${label}.version is required`);
  }
  if (typeof rec.tarball !== "string" || !rec.tarball) {
    throw new Error(`${label}.tarball is required`);
  }
  if (typeof rec.sha256 !== "string" || !rec.sha256) {
    throw new Error(`${label}.sha256 is required`);
  }
  return {
    name: rec.name,
    version: rec.version,
    tarball: rec.tarball,
    sha256: rec.sha256,
  };
}

/**
 * @param {unknown[]} packages
 */
function requireLockstepVersion(packages) {
  const versions = [];
  for (const entry of packages) {
    if (!entry || typeof entry !== "object" || typeof entry.version !== "string" || !entry.version) {
      throw new Error("package entry.version is required");
    }
    versions.push(entry.version);
  }
  if (new Set(versions).size !== 1) {
    throw new Error(`package versions are not lockstep (${[...new Set(versions)].join(",")})`);
  }
  return versions[0];
}
