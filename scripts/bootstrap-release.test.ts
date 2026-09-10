import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_BOOTSTRAP_VERSION,
  buildBootstrapPlan,
  publishReadinessIssues,
} from "./bootstrap-plan.js";

/**
 * Bootstrap plan invariants (Phase 2.4A): the manual publish commands must
 * never target `latest` and must always publish the exact reviewed tarballs
 * with public access.
 *
 * These tests import ONLY the pure module `bootstrap-plan.ts` — importing it
 * must cause no network access, no pnpm execution, no artifact writes, and
 * no process.exit. (Regression: the CLI entrypoint previously ran the whole
 * release dry-run + registry preflight at import time, making `pnpm test`
 * depend on npm registry state.)
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

describe("bootstrap-plan module purity", () => {
  it("the pure module imports with zero side effects (this import already proves it)", () => {
    // If bootstrap-plan.ts performed I/O at import time (dry-run, npm view,
    // artifact writes, process.exit), this test file would hang, hit the
    // network, or kill the test runner. It does none of those.
    expect(typeof buildBootstrapPlan).toBe("function");
    expect(typeof publishReadinessIssues).toBe("function");
  });

  it("contains no I/O / process control primitives (static source audit)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "bootstrap-plan.ts"), "utf8");
    expect(source).not.toMatch(/execFileSync|spawnSync|process\.exit|process\.argv/);
    expect(source).not.toMatch(/readFileSync|writeFileSync|rmSync|mkdirSync/);
    expect(source).not.toMatch(/npm\s+view|pnpm\s+release/);
  });

  it("the CLI entrypoint has a main-module guard", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "bootstrap-release.ts"), "utf8");
    expect(source).toMatch(/if \(process\.argv\[1\].*import\.meta\.url/s);
    expect(source).toContain('from "./bootstrap-plan.js"');
  });
});

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

describe("publishReadinessIssues", () => {
  const clean = { head: "aaa", branch: "main", dirty: false, originMain: "aaa" };

  it("passes on clean reviewed main", () => {
    expect(publishReadinessIssues(clean)).toEqual([]);
  });

  it("rejects a dirty tree", () => {
    expect(publishReadinessIssues({ ...clean, dirty: true }).join()).toMatch(/dirty/);
  });

  it("rejects a feature branch", () => {
    expect(publishReadinessIssues({ ...clean, branch: "feat/x" }).join()).toMatch(/not main/);
  });

  it("rejects HEAD ahead of origin/main (unpushed local commits)", () => {
    expect(publishReadinessIssues({ ...clean, head: "bbb" }).join()).toMatch(/origin\/main/);
  });

  it("reports all violations together", () => {
    const issues = publishReadinessIssues({ head: "bbb", branch: "feat/x", dirty: true, originMain: "aaa" });
    expect(issues).toHaveLength(3);
  });
});
