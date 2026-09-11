/**
 * Locate + verify a downloaded `release-check-<sha>` artifact.
 * Used by bootstrap:check --publish-ready and the stage/verify workflow.
 * Never packs, never rebuilds.
 *
 * When expectedHead is supplied, a missing identity is FAIL CLOSED
 * (never a silent pass).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { locateArtifactRoot, verifySha256Sums } from "./sha256sums.js";
import {
  EXPECTED_PACKAGE_COUNT,
  PUBLIC_PACKAGE_NAMES,
  type ReleaseIdentity,
} from "./release-identity.js";
import { validateCanonicalReleaseDir } from "./canonical-validate.mjs";

export interface CanonicalArtifact {
  root: string;
  manifestPath: string;
  sumsPath: string;
  tarballDir: string;
  tarballs: string[];
  manifest: CanonicalManifest;
}

export interface CanonicalManifest {
  identity?: ReleaseIdentity;
  publish_order: string[];
  packages: { name: string; version: string; tarball: string; sha256: string }[];
  git?: { head?: string };
  version?: string;
}

export function readCanonicalManifest(root: string): CanonicalManifest {
  const path = join(root, "release-manifest.json");
  if (!existsSync(path)) throw new Error(`release-manifest.json missing under ${root}`);
  return JSON.parse(readFileSync(path, "utf8")) as CanonicalManifest;
}

export function listTarballs(root: string): string[] {
  const dir = join(root, "tarballs");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`tarballs/ directory missing under ${root}`);
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tgz"))
    .sort();
}

export interface ArtifactVerifyIssue {
  code: string;
  message: string;
}

export function verifyCanonicalArtifactLayout(
  downloadDir: string,
  expectedHead?: string,
  expectedVersion?: string,
): { artifact: CanonicalArtifact; issues: ArtifactVerifyIssue[] } {
  const issues: ArtifactVerifyIssue[] = [];
  const root = locateArtifactRoot(downloadDir);
  const tarballs = listTarballs(root);
  if (tarballs.length !== EXPECTED_PACKAGE_COUNT) {
    issues.push({
      code: "tarball-count",
      message: `expected ${EXPECTED_PACKAGE_COUNT} tarballs, found ${tarballs.length}`,
    });
  }
  const sums = verifySha256Sums(root);
  if (!sums.ok) {
    issues.push({ code: "sha256sums", message: sums.errors.join("; ") });
  }
  const manifest = readCanonicalManifest(root);
  if (!Array.isArray(manifest.publish_order) || manifest.publish_order.length === 0) {
    issues.push({ code: "publish-order", message: "manifest.publish_order missing or empty" });
  }
  const byName = new Map(manifest.packages.map((p) => [p.name, p]));
  for (const name of PUBLIC_PACKAGE_NAMES) {
    if (!byName.has(name)) {
      issues.push({ code: "package-missing", message: `manifest missing ${name}` });
    }
  }
  for (const name of manifest.publish_order ?? []) {
    if (!byName.has(name)) {
      issues.push({ code: "publish-order", message: `publish_order references unknown ${name}` });
    }
  }

  // CRITICAL: expectedHead + missing identity must FAIL (never pass).
  if (expectedHead && (manifest.identity == null || typeof manifest.identity !== "object")) {
    issues.push({
      code: "identity-missing",
      message: "FAIL: expectedHead supplied but canonical identity is missing",
    });
  }

  try {
    validateCanonicalReleaseDir({
      dir: root,
      expectedHead,
      expectedVersion,
      requireIdentity: Boolean(expectedHead),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes("identity is missing")
      ? "identity-missing"
      : message.includes("git_sha")
        ? "git-sha"
        : message.includes("SHA256SUMS") || message.includes("sha256")
          ? "sha256sums"
          : "canonical";
    if (!issues.some((i) => i.message === message)) {
      issues.push({ code, message });
    }
  }

  const identity = manifest.identity;
  if (identity) {
    for (const bad of ["generated_at", "timestamp", "hostname", "run_id", "node_version"] as const) {
      if (bad in identity) {
        issues.push({ code: "identity", message: `non-deterministic identity field ${bad}` });
      }
    }
  }
  return {
    artifact: {
      root,
      manifestPath: join(root, "release-manifest.json"),
      sumsPath: join(root, "SHA256SUMS"),
      tarballDir: join(root, "tarballs"),
      tarballs: tarballs.map((f) => join(root, "tarballs", f)),
      manifest,
    },
    issues,
  };
}
