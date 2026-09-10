/**
 * Pure bootstrap-plan module (Phase 2.4A review hardening).
 *
 * NO I/O, NO network, no process control — importing this module has zero
 * side effects, so unit tests never touch the npm registry, pnpm, or the
 * filesystem. The CLI entry point lives in `bootstrap-release.ts`.
 */

/** The Phase 2.4A bootstrap candidate. rc.1+ releases use the OIDC workflow. */
export const EXPECTED_BOOTSTRAP_VERSION = "0.9.0-rc.0";
export const BOOTSTRAP_DIST_TAG = "next";
export const BOOTSTRAP_ACCESS = "public";
/**
 * The ONLY publish destination. Pinned into every generated command so a
 * maintainer environment with a custom default/scope registry can never
 * receive the reviewed tarballs by accident.
 */
export const BOOTSTRAP_REGISTRY = "https://registry.npmjs.org/";

export interface ReleaseManifestLike {
  publish_order: string[];
  packages: { name: string; version: string; tarball: string; sha256: string }[];
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
  git: { head: string; branch: string; dirty: boolean };
  publish_order: string[];
  packages: {
    name: string;
    version: string;
    tarball: string;
    sha256: string;
    publish_command: string;
  }[];
  notes: string[];
}

/**
 * Build the machine-readable bootstrap plan from the release manifest's
 * COMPUTED publish order (never a remembered fixed order). Pure function —
 * unit-tested without network or packing.
 */
export function buildBootstrapPlan(
  manifest: ReleaseManifestLike,
  git: { head: string; branch: string; dirty: boolean },
): BootstrapPlan {
  const byName = new Map(manifest.packages.map((p) => [p.name, p]));
  return {
    kind: "actionmanifest-bootstrap-plan",
    dry_run: true,
    registry_writes: "none (plan only; the manual bootstrap is a maintainer operation)",
    version: EXPECTED_BOOTSTRAP_VERSION,
    dist_tag: BOOTSTRAP_DIST_TAG,
    access: BOOTSTRAP_ACCESS,
    registry: BOOTSTRAP_REGISTRY,
    generated_by: "scripts/bootstrap-release.ts",
    git,
    publish_order: manifest.publish_order,
    packages: manifest.publish_order.map((name) => {
      const entry = byName.get(name);
      if (!entry) throw new Error(`publish_order references unknown package ${name}`);
      return {
        name,
        version: entry.version,
        tarball: `release-artifacts/${entry.tarball}`,
        sha256: entry.sha256,
        publish_command:
          `npm publish ./release-artifacts/${entry.tarball} --access ${BOOTSTRAP_ACCESS} --tag ${BOOTSTRAP_DIST_TAG} --registry ${BOOTSTRAP_REGISTRY}`,
      };
    }),
    notes: [
      "Publish EXACTLY these tarballs — never re-pack from a package directory (approved artifact != rebuilt artifact).",
      "Publish in publish_order so dependencies exist on the registry first.",
      "--tag next keeps the bootstrap off the latest dist-tag.",
      "After all 10 packages exist: configure Trusted Publishers (docs/RELEASING.md), then rc.1+ ships via OIDC only.",
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
 * dirty tree is fine — but the irreversible manual publish must come from
 * the reviewed main tip: clean tree, on `main`, HEAD == origin/main.
 */
export function publishReadinessIssues(state: PublishReadyGitState): string[] {
  const issues: string[] = [];
  if (state.dirty) {
    issues.push("working tree is dirty — release artifacts must come from a clean, reviewed commit");
  }
  if (state.branch !== "main") {
    issues.push(`branch is "${state.branch}", not main — the manual bootstrap publishes from reviewed main only`);
  }
  if (state.head !== state.originMain) {
    issues.push("HEAD != origin/main — local commits are not the reviewed remote state");
  }
  return issues;
}
