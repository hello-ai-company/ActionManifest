/**
 * Pure bootstrap / canonical-release plan module.
 *
 * NO I/O, NO network, no process control — importing this module has zero
 * side effects. The CLI entry point lives in `bootstrap-release.ts`.
 */

import {
  CANONICAL_REGISTRY,
  distTagForVersion,
  stagePublishCommand,
} from "./release-identity.js";

/** The Phase 2.4A bootstrap version. rc.0 publish is COMPLETE; do not republish. */
export const EXPECTED_BOOTSTRAP_VERSION = "0.9.0-rc.0";
export const BOOTSTRAP_DIST_TAG = "next";
export const BOOTSTRAP_ACCESS = "public";
export const BOOTSTRAP_REGISTRY = CANONICAL_REGISTRY;

export interface ReleaseManifestLike {
  publish_order: string[];
  packages: { name: string; version: string; tarball: string; sha256: string }[];
  identity?: { git_sha?: string; git_tree?: string; version?: string };
}

export interface BootstrapPlan {
  kind: "actionmanifest-bootstrap-plan";
  dry_run: true;
  registry_writes: string;
  version: string;
  dist_tag: string;
  access: string;
  registry: string;
  generated_by: string;
  artifact_source: "local-noncanonical" | "canonical-release-check";
  git: { head: string; branch: string; dirty: boolean };
  publish_order: string[];
  packages: {
    name: string;
    version: string;
    tarball: string;
    sha256: string;
    publish_command: string;
    stage_command: string;
  }[];
  notes: string[];
}

function packageRows(
  manifest: ReleaseManifestLike,
  tarballPrefix: string,
): BootstrapPlan["packages"] {
  const byName = new Map(manifest.packages.map((p) => [p.name, p]));
  return manifest.publish_order.map((name) => {
    const entry = byName.get(name);
    if (!entry) throw new Error(`publish_order references unknown package ${name}`);
    const rel = entry.tarball.startsWith("tarballs/") ? entry.tarball : `tarballs/${entry.tarball}`;
    const tarball = `${tarballPrefix}${rel}`;
    return {
      name,
      version: entry.version,
      tarball,
      sha256: entry.sha256,
      publish_command:
        `npm publish ./${tarball} --access ${BOOTSTRAP_ACCESS} --tag ${BOOTSTRAP_DIST_TAG} --registry ${BOOTSTRAP_REGISTRY}`,
      stage_command: stagePublishCommand(`./${tarball}`, entry.version),
    };
  });
}

/**
 * Historical bootstrap plan (manual `npm publish --tag next`).
 * Used by `--prepare` (local, NON-CANONICAL artifacts).
 */
export function buildBootstrapPlan(
  manifest: ReleaseManifestLike,
  git: { head: string; branch: string; dirty: boolean },
): BootstrapPlan {
  return {
    kind: "actionmanifest-bootstrap-plan",
    dry_run: true,
    registry_writes: "none (plan only; the manual bootstrap is a maintainer operation)",
    version: EXPECTED_BOOTSTRAP_VERSION,
    dist_tag: BOOTSTRAP_DIST_TAG,
    access: BOOTSTRAP_ACCESS,
    registry: BOOTSTRAP_REGISTRY,
    generated_by: "scripts/bootstrap-release.ts",
    artifact_source: "local-noncanonical",
    git,
    publish_order: manifest.publish_order,
    packages: packageRows(manifest, "release-artifacts/"),
    notes: [
      "These tarballs are LOCAL / NON-CANONICAL (operator machine). Do not publish them.",
      "BUILD ONCE / VERIFY ONCE / STAGE EXACT ARTIFACT — only the exact-head Release Check artifact is canonical.",
      "0.9.0-rc.0 bootstrap is COMPLETE (10/10 on npm). Do not republish rc.0.",
      "Subsequent versions: maintainer tag → workflow_dispatch release.yml mode=stage → npm stage publish of the downloaded artifact.",
      "Do not auto-repair dist-tags. rc.0 first publish set latest=rc.0 historically — documented only.",
    ],
  };
}

/**
 * Canonical plan from a downloaded Release Check artifact.
 * Paths point at the downloaded files. Stage commands use npm stage publish.
 */
export function buildCanonicalReleasePlan(
  manifest: ReleaseManifestLike,
  git: { head: string; branch: string; dirty: boolean },
  artifactPrefix: string,
): BootstrapPlan {
  const prefix = artifactPrefix.endsWith("/") ? artifactPrefix : `${artifactPrefix}/`;
  const version = manifest.packages[0]?.version ?? EXPECTED_BOOTSTRAP_VERSION;
  return {
    kind: "actionmanifest-bootstrap-plan",
    dry_run: true,
    registry_writes: "none (plan only; staging is GitHub Actions OIDC + human 2FA approve)",
    version,
    dist_tag: distTagForVersion(version),
    access: BOOTSTRAP_ACCESS,
    registry: BOOTSTRAP_REGISTRY,
    generated_by: "scripts/bootstrap-release.ts --publish-ready",
    artifact_source: "canonical-release-check",
    git,
    publish_order: manifest.publish_order,
    packages: packageRows(manifest, prefix),
    notes: [
      "Plan points at the DOWNLOADED exact-head Release Check artifact — never a local rebuild.",
      "BUILD ONCE / VERIFY ONCE / STAGE EXACT ARTIFACT.",
      "Stage via .github/workflows/release.yml (workflow_dispatch, mode=stage). Do not npm publish. Do not npm stage approve from CI.",
      "0.9.0-rc.0 bootstrap is COMPLETE. Do not republish that version. Do not auto-repair dist-tags.",
      "CLI timeout or packument 404 after a publish is NOT a publish failure — read the registry first; never republish solely for lag.",
    ],
  };
}

export interface PublishReadyGitState {
  head: string;
  branch: string;
  dirty: boolean;
  /** `git rev-parse origin/main` at check time. */
  originMain: string;
}

/**
 * Publish-readiness policy (pure). Preparing on a feature branch with a
 * dirty tree is fine — but consuming the canonical artifact for a real
 * stage must come from the reviewed main tip: clean tree, on `main`,
 * HEAD == origin/main.
 */
export function publishReadinessIssues(state: PublishReadyGitState): string[] {
  const issues: string[] = [];
  if (state.dirty) {
    issues.push("working tree is dirty — release artifacts must come from a clean, reviewed commit");
  }
  if (state.branch !== "main") {
    issues.push(`branch is "${state.branch}", not main — canonical consume/stage is from reviewed main only`);
  }
  if (state.head !== state.originMain) {
    issues.push("HEAD != origin/main — local commits are not the reviewed remote state");
  }
  return issues;
}
