import { describe, expect, it } from "vitest";
import {
  EXPECTED_BOOTSTRAP_VERSION,
  buildBootstrapPlan,
} from "./bootstrap-release.js";

/**
 * Bootstrap plan invariants (Phase 2.4A): the manual publish commands must
 * never target `latest` and must always publish the exact reviewed tarballs
 * with public access.
 */

const manifest = {
  publish_order: ["@actionmanifest/schema", "@actionmanifest/core", "@actionmanifest/cli"],
  packages: [
    { name: "@actionmanifest/schema", version: "0.9.0-rc.0", tarball: "tarballs/a.tgz", sha256: "a".repeat(64) },
    { name: "@actionmanifest/core", version: "0.9.0-rc.0", tarball: "tarballs/b.tgz", sha256: "b".repeat(64) },
    { name: "@actionmanifest/cli", version: "0.9.0-rc.0", tarball: "tarballs/c.tgz", sha256: "c".repeat(64) },
  ],
};

const git = { head: "deadbeef", branch: "main", dirty: false };

describe("buildBootstrapPlan", () => {
  it("emits exact-tarball publish commands in the manifest's computed order", () => {
    const plan = buildBootstrapPlan(manifest, git);
    expect(plan.version).toBe(EXPECTED_BOOTSTRAP_VERSION);
    expect(plan.publish_order).toEqual(manifest.publish_order);
    expect(plan.packages.map((p) => p.name)).toEqual(manifest.publish_order);
    for (const p of plan.packages) {
      // Exact tarball path — never a package directory (no implicit re-pack).
      expect(p.tarball).toMatch(/^release-artifacts\/tarballs\//);
      expect(p.publish_command).toContain(`npm publish ./${p.tarball}`);
    }
  });

  it("every command uses --access public (scoped first publish)", () => {
    const plan = buildBootstrapPlan(manifest, git);
    for (const p of plan.packages) {
      expect(p.publish_command).toContain("--access public");
    }
    expect(plan.access).toBe("public");
  });

  it("every command uses --tag next and never targets latest", () => {
    const plan = buildBootstrapPlan(manifest, git);
    expect(plan.dist_tag).toBe("next");
    for (const p of plan.packages) {
      expect(p.publish_command).toContain("--tag next");
      expect(p.publish_command).not.toContain("latest");
    }
  });

  it("carries sha256 per package and no secrets", () => {
    const plan = buildBootstrapPlan(manifest, git);
    for (const p of plan.packages) {
      expect(p.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_auth/i);
  });

  it("is a dry run by construction", () => {
    const plan = buildBootstrapPlan(manifest, git);
    expect(plan.dry_run).toBe(true);
    expect(plan.registry_writes).toContain("none");
  });

  it("fails when publish_order references an unknown package", () => {
    expect(() =>
      buildBootstrapPlan(
        { publish_order: ["@actionmanifest/ghost"], packages: manifest.packages },
        git,
      ),
    ).toThrowError(/unknown package/);
  });
});
