import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PINNED_NPM_CLI, PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import { parseSetupArgs, parseSetupCli, runReleaseSetup, workflowReferencesNpmRelease, type SetupDeps } from "./release-setup.js";
import type { GitHubControlPlaneClient } from "./release-setup-github.js";
import { isForbiddenNpmArgv, parseTrustedPublisherList, npmVersionAtLeast, npmVersionIsExactPinned } from "./release-setup-npm.js";
import type { NpmTrustClient } from "./release-setup-npm.js";
import { PINNED_NPM_PACKAGE_SPEC, isExactPinnedNpmSpec, resolvePinnedNpm } from "./release-setup-npm-runner.js";
import {
  DESIRED_RULESET_RULE_OBJECTS,
  RELEASE_ENVIRONMENT_NAME,
  RELEASE_REPO_SLUG,
  RELEASE_RULESET_NAME,
  containsForbiddenSecret,
  emptyEnvironmentActual,
  type GitHubEnvironmentActual,
  type PackageSecurityActual,
  type ReadyVariableActual,
  type RepoIdentityActual,
  type RulesetSnapshot,
  type TagRulesetActual,
  type TrustedPublisherActual,
  type TrustedPublisherRecord,
} from "./release-setup-plan.js";

const expectedPublisher: TrustedPublisherRecord = {
  provider: "github",
  org: "hello-ai-company",
  repo: "ActionManifest",
  workflow: "release.yml",
  environment: "npm-release",
  allowStagePublish: true,
  allowPublish: false,
};

class MemoryGitHub implements GitHubControlPlaneClient {
  writes: string[] = [];
  envExists = false;
  envBranches: string[] = [];
  rulesets: RulesetSnapshot[] = [];
  unrelated = [{ id: 99, name: "do-not-touch-me" }];
  ready: string | null = null;
  repoOk = true;

  async verifyRepo(): Promise<RepoIdentityActual> {
    return this.repoOk
      ? { slug: RELEASE_REPO_SLUG, verified: true, status: "OK", notes: [] }
      : { slug: "evil/fork", verified: false, status: "DRIFTED", notes: ["wrong repo"] };
  }
  async getEnvironment(): Promise<GitHubEnvironmentActual> {
    return emptyEnvironmentActual({
      exists: this.envExists,
      name: RELEASE_ENVIRONMENT_NAME,
      deploymentBranches: this.envBranches,
      waitTimer: this.envExists ? 0 : null,
      preventSelfReview: this.envExists ? false : null,
      deploymentBranchPolicy: this.envExists
        ? { protected_branches: false, custom_branch_policies: true }
        : null,
      secretNames: [],
      secretsReadStatus: this.envExists ? "OK" : "SKIPPED",
      branchPoliciesReadStatus: this.envExists ? "OK" : "SKIPPED",
      status: this.envExists ? "OK" : "MISSING",
    });
  }
  async listRulesets(): Promise<TagRulesetActual> {
    return {
      managed: [...this.rulesets],
      unrelated: [...this.unrelated],
      status: this.rulesets.length === 0 ? "MISSING" : "OK",
      notes: [],
    };
  }
  async getVariable(): Promise<ReadyVariableActual> {
    return {
      exists: this.ready !== null,
      value: this.ready,
      status: this.ready === "true" ? "OK" : "MISSING",
      notes: [],
    };
  }
  async createEnvironment(): Promise<void> {
    this.writes.push("createEnvironment");
    this.envExists = true;
    this.envBranches = ["main"];
  }
  async updateEnvironment(): Promise<void> {
    this.writes.push("updateEnvironment");
    this.envExists = true;
    this.envBranches = ["main"];
  }
  async createRuleset(): Promise<void> {
    this.writes.push("createRuleset");
    this.rulesets = [
      {
        id: 1,
        name: RELEASE_RULESET_NAME,
        target: "tag",
        enforcement: "active",
        include: ["refs/tags/v*"],
        rules: ["deletion", "update", "non_fast_forward"],
        ruleObjects: DESIRED_RULESET_RULE_OBJECTS.map((rule) =>
          rule.parameters ? { type: rule.type, parameters: { ...rule.parameters } } : { type: rule.type },
        ),
      },
    ];
  }
  async updateRuleset(id: number): Promise<void> {
    this.writes.push(`updateRuleset:${id}`);
    this.rulesets = this.rulesets.map((r) =>
      r.id === id
        ? {
            ...r,
            target: "tag",
            enforcement: "active",
            include: ["refs/tags/v*"],
            rules: ["deletion", "update", "non_fast_forward"],
            ruleObjects: DESIRED_RULESET_RULE_OBJECTS.map((rule) =>
              rule.parameters ? { type: rule.type, parameters: { ...rule.parameters } } : { type: rule.type },
            ),
          }
        : r,
    );
  }
  async setReadyVariable(): Promise<void> {
    this.writes.push("setReadyVariable");
    this.ready = "true";
  }
}

class MemoryNpm implements NpmTrustClient {
  writes: string[] = [];
  publishers = new Map<string, TrustedPublisherActual>();
  security = new Map<string, PackageSecurityActual>();

  constructor() {
    for (const name of PUBLIC_PACKAGE_NAMES) {
      this.publishers.set(name, { packageName: name, exists: false, status: "MISSING", notes: [] });
      this.security.set(name, {
        packageName: name,
        twoFactorRequired: true,
        longLivedTokensDisallowed: true,
        trustedPublishingUsed: false,
        status: "OK",
        notes: [],
      });
    }
  }

  async inspectCli() {
    return {
      version: "11.15.0",
      trust: true,
      trustList: true,
      trustGithub: true,
      access: true,
      accessSetMfa: true,
      stage: true,
      notes: [],
    };
  }
  async listTrustedPublisher(packageName: string): Promise<TrustedPublisherActual> {
    return this.publishers.get(packageName) ?? {
      packageName,
      exists: false,
      status: "MISSING",
      notes: [],
    };
  }
  async addTrustedPublisher(packageName: string): Promise<void> {
    this.writes.push(`addTrustedPublisher:${packageName}`);
    this.publishers.set(packageName, {
      packageName,
      exists: true,
      publisher: { ...expectedPublisher },
      status: "OK",
      notes: [],
    });
  }
  async getPackageSecurity(packageName: string): Promise<PackageSecurityActual> {
    return (
      this.security.get(packageName) ?? {
        packageName,
        twoFactorRequired: "UNKNOWN",
        longLivedTokensDisallowed: "UNKNOWN",
        trustedPublishingUsed: "UNKNOWN",
        status: "UNKNOWN",
        notes: [],
      }
    );
  }
  async applyAutomatableSecurity(packageName: string): Promise<void> {
    this.writes.push(`applyAutomatableSecurity:${packageName}`);
  }
}

function deps(github: MemoryGitHub, npm: MemoryNpm): { deps: SetupDeps; logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    deps: {
      github,
      npm,
      readWorkflow: () => "jobs:\n  stage:\n    environment: npm-release\n",
      log: (line) => logs.push(line),
      paceTrustedPublisherWrites: async () => {},
    },
  };
}

describe("parseSetupArgs", () => {
  it("defaults to check (no --apply ⇒ zero writes)", () => {
    expect(parseSetupArgs([])).toBe("check");
    expect(parseSetupArgs(["--check"])).toBe("check");
    expect(parseSetupArgs(["--apply"])).toBe("apply");
  });
});

describe("parseSetupCli attestation flag", () => {
  it("does not silently attest without the explicit flag", () => {
    expect(parseSetupCli([]).attestManualSecurity).toBe(false);
    expect(parseSetupCli(["--check"]).attestationPath).toBeNull();
    expect(parseSetupCli(["--apply"]).attestManualSecurity).toBe(false);
  });

  it("requires an explicit path or the documented default evidence file", () => {
    const bare = parseSetupCli(["--check", "--attest-manual-security"]);
    expect(bare.mode).toBe("check");
    expect(bare.attestManualSecurity).toBe(true);
    expect(bare.attestationPath).toBe("docs/evidence/manual-package-security-attestation.json");
    const eq = parseSetupCli(["--attest-manual-security=release-manual-security-attestation.json"]);
    expect(eq.attestManualSecurity).toBe(true);
    expect(eq.attestationPath).toBe("release-manual-security-attestation.json");
    const next = parseSetupCli(["--apply", "--attest-manual-security", "./attested.json"]);
    expect(next.mode).toBe("apply");
    expect(next.attestationPath).toBe("./attested.json");
  });
});

describe("check / apply write guards", () => {
  it("--check performs zero writes even when everything is missing", async () => {
    const github = new MemoryGitHub();
    const npm = new MemoryNpm();
    const { deps: d } = deps(github, npm);
    const result = await runReleaseSetup("check", d);
    expect(github.writes).toEqual([]);
    expect(npm.writes).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(result.plan.verdict).not.toBe("READY");
  });

  it("no --apply path uses check mode", async () => {
    expect(parseSetupArgs(["--verbose"])).toBe("check");
  });

  it("READY is the last write; prerequisites failing means READY is not set", async () => {
    const github = new MemoryGitHub();
    const npm = new MemoryNpm();
    npm.publishers.set(PUBLIC_PACKAGE_NAMES[0]!, {
      packageName: PUBLIC_PACKAGE_NAMES[0]!,
      exists: true,
      publisher: { ...expectedPublisher, repo: "evil" },
      status: "DRIFTED",
      notes: [],
    });
    const { deps: d } = deps(github, npm);
    const result = await runReleaseSetup("apply", d);
    expect(github.writes.includes("setReadyVariable")).toBe(false);
    expect(result.writes.includes("ready")).toBe(false);
    expect(result.plan.verdict).toBe("BLOCKED");
  });

  it("one TP fail after env+ruleset create does not set READY", async () => {
    const github = new MemoryGitHub();
    const npm = new MemoryNpm();
    // 9 packages will be created; leave one drifted so apply stops before writes
    npm.publishers.set("@actionmanifest/cli", {
      packageName: "@actionmanifest/cli",
      exists: true,
      publisher: { ...expectedPublisher, workflow: "other.yml" },
      status: "DRIFTED",
      notes: [],
    });
    const { deps: d } = deps(github, npm);
    const result = await runReleaseSetup("apply", d);
    expect(github.writes).toEqual([]);
    expect(npm.writes).toEqual([]);
    expect(result.plan.items.find((i) => i.id === "tp:@actionmanifest/cli")?.action).toBe("STOP");
  });

  it("apply then second apply is idempotent (zero mutations)", async () => {
    const github = new MemoryGitHub();
    const npm = new MemoryNpm();
    const first = deps(github, npm);
    const applied = await runReleaseSetup("apply", first.deps);
    expect(applied.writes.length).toBeGreaterThan(0);
    expect(containsForbiddenSecret(JSON.stringify(applied.report))).toBe(false);
    expect(github.writes.at(-1)).toBe("setReadyVariable");
    expect(github.ready).toBe("true");
    expect(github.unrelated).toEqual([{ id: 99, name: "do-not-touch-me" }]);
    const before = [...github.writes];
    const npmBefore = [...npm.writes];
    const second = await runReleaseSetup("apply", first.deps);
    expect(second.writes).toEqual([]);
    expect(github.writes).toEqual(before);
    expect(npm.writes).toEqual(npmBefore);
    expect(second.plan.verdict).toBe("READY");
    expect(first.logs.join("\n")).toMatch(/NO CHANGES REQUIRED|planned writes/);
  });

  it("unrelated env/ruleset names never appear in writes", async () => {
    const github = new MemoryGitHub();
    const npm = new MemoryNpm();
    await runReleaseSetup("apply", deps(github, npm).deps);
    expect(github.writes.join(" ")).not.toContain("do-not-touch-me");
  });

  it("READY last among recorded writes", async () => {
    const github = new MemoryGitHub();
    const npm = new MemoryNpm();
    await runReleaseSetup("apply", deps(github, npm).deps);
    expect(github.writes.at(-1)).toBe("setReadyVariable");
    expect(github.writes.indexOf("createEnvironment")).toBeLessThan(github.writes.indexOf("setReadyVariable"));
    expect(github.writes.indexOf("createRuleset")).toBeLessThan(github.writes.indexOf("setReadyVariable"));
  });

  it("MANUAL_REQUIRED without attestation never sets READY; valid attestation may after other prereqs", async () => {
    const github = new MemoryGitHub();
    const npm = new MemoryNpm();
    for (const name of PUBLIC_PACKAGE_NAMES) {
      npm.security.set(name, {
        packageName: name,
        twoFactorRequired: "UNKNOWN",
        longLivedTokensDisallowed: "UNKNOWN",
        trustedPublishingUsed: true,
        status: "MANUAL_REQUIRED",
        notes: [],
      });
    }
    const blocked = await runReleaseSetup("apply", deps(github, npm).deps);
    expect(github.writes.includes("setReadyVariable")).toBe(false);
    expect(blocked.plan.items.find((i) => i.id === "ready")?.action).not.toBe("SET_READY");

    const github2 = new MemoryGitHub();
    const npm2 = new MemoryNpm();
    for (const name of PUBLIC_PACKAGE_NAMES) {
      npm2.security.set(name, {
        packageName: name,
        twoFactorRequired: "UNKNOWN",
        longLivedTokensDisallowed: "UNKNOWN",
        trustedPublishingUsed: true,
        status: "MANUAL_REQUIRED",
        notes: [],
      });
    }
    const attested = await runReleaseSetup("apply", deps(github2, npm2).deps, {
      attestation: {
        requested: true,
        applied: true,
        coveredPackages: [...PUBLIC_PACKAGE_NAMES],
        attestedBy: "release-maintainer",
        attestedAt: "2026-09-12T05:00:00Z",
      },
    });
    expect(github2.writes.at(-1)).toBe("setReadyVariable");
    expect(attested.plan.verdict).toBe("READY");

    const github3 = new MemoryGitHub();
    github3.ready = "true";
    github3.envExists = true;
    github3.envBranches = ["main"];
    github3.rulesets = [
      {
        id: 1,
        name: RELEASE_RULESET_NAME,
        target: "tag",
        enforcement: "active",
        include: ["refs/tags/v*"],
        rules: ["deletion", "update", "non_fast_forward"],
        ruleObjects: DESIRED_RULESET_RULE_OBJECTS.map((rule) =>
          rule.parameters ? { type: rule.type, parameters: { ...rule.parameters } } : { type: rule.type },
        ),
      },
    ];
    const npm3 = new MemoryNpm();
    for (const name of PUBLIC_PACKAGE_NAMES) {
      npm3.publishers.set(name, {
        packageName: name,
        exists: true,
        publisher: { ...expectedPublisher },
        status: "OK",
        notes: [],
      });
      npm3.security.set(name, {
        packageName: name,
        twoFactorRequired: "UNKNOWN",
        longLivedTokensDisallowed: "UNKNOWN",
        trustedPublishingUsed: true,
        status: "MANUAL_REQUIRED",
        notes: [],
      });
    }
    const critical = await runReleaseSetup("check", deps(github3, npm3).deps);
    expect(critical.plan.verdict).toBe("BLOCKED");
    expect(critical.plan.critical.join(" ")).toMatch(/CRITICAL/);
  });
});

describe("npm / GitHub command safety (static + helpers)", () => {
  it("forbids publish / stage publish / approve / unpublish / dist-tag / --otp", () => {
    expect(isForbiddenNpmArgv(["publish", "pkg.tgz"])).toBe(true);
    expect(isForbiddenNpmArgv(["stage", "publish", "pkg.tgz"])).toBe(true);
    expect(isForbiddenNpmArgv(["stage", "approve", "id"])).toBe(true);
    expect(isForbiddenNpmArgv(["unpublish", "pkg"])).toBe(true);
    expect(isForbiddenNpmArgv(["deprecate", "pkg"])).toBe(true);
    expect(isForbiddenNpmArgv(["dist-tag", "add", "pkg"])).toBe(true);
    expect(isForbiddenNpmArgv(["trust", "github", "pkg", "--otp", "123456"])).toBe(true);
    expect(isForbiddenNpmArgv(["trust", "list", "@actionmanifest/core"])).toBe(false);
    expect(isForbiddenNpmArgv(["trust", "github", "pkg", "--allow-stage-publish"])).toBe(false);
  });

  it("pins write CLI at 11.15.0 and rejects older npm", () => {
    expect(npmVersionAtLeast("11.15.0", "11.15.0")).toBe(true);
    expect(npmVersionAtLeast("11.14.1", "11.15.0")).toBe(false);
    expect(npmVersionAtLeast("10.9.7", "11.15.0")).toBe(false);
    expect(npmVersionIsExactPinned("11.15.0")).toBe(true);
    expect(npmVersionIsExactPinned("11.16.0")).toBe(false);
    expect(npmVersionIsExactPinned("10.9.7")).toBe(false);
  });

  it("selects exact npm 11.15.0 even when host is 10.x", () => {
    const resolved = resolvePinnedNpm({ hostNpmVersion: "10.9.7", env: {}, repoRoot: "/tmp/no-such-actionmanifest-root" });
    expect(resolved.version).toBe(PINNED_NPM_CLI);
    expect(resolved.version).toBe("11.15.0");
    expect(resolved.spec).toBe(PINNED_NPM_PACKAGE_SPEC);
    expect(isExactPinnedNpmSpec(resolved.spec)).toBe(true);
    expect(resolved.spec).not.toContain("latest");
    expect(resolved.source).toBe("npx-exact");
    expect(resolved.argvPrefix.join(" ")).toContain(`--package=${PINNED_NPM_PACKAGE_SPEC}`);
    expect(resolved.argvPrefix.join(" ")).not.toContain("npm@latest");
  });

  it("source never contains npm publish / stage approve / gh release create / git tag", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of [
      "release-setup.ts",
      "release-setup-github.ts",
      "release-setup-npm.ts",
      "release-setup-plan.ts",
      "release-setup-npm-runner.ts",
      "release-setup-attestation.ts",
    ]) {
      const src = readFileSync(join(here, file), "utf8");
      expect(src, file).not.toMatch(/npm publish /);
      expect(src, file).not.toMatch(/stage approve/);
      expect(src, file).not.toMatch(/gh release create/);
      expect(src, file).not.toMatch(/git tag /);
      expect(src, file).not.toMatch(/npm@latest/);
      expect(src, file).not.toMatch(/MANAGED_RULESET_RULES\.map\(\(type\)=>\(\{type\}\)\)/);
    }
  });

  it("CLI has a main-module guard and package.json script", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "release-setup.ts"), "utf8");
    expect(src).toMatch(/if \(process\.argv\[1\].*import\.meta\.url/s);
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      version: string;
    };
    expect(pkg.scripts["release:setup"]).toBe("tsx scripts/release-setup.ts");
    expect(pkg.version).toBe("0.1.0");
  });

  it("release.yml still references environment: npm-release (Phase 2.4B contract)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const yml = readFileSync(join(here, "..", ".github/workflows/release.yml"), "utf8");
    expect(workflowReferencesNpmRelease(yml)).toBe(true);
  });

  it("public package versions stay 0.9.0-rc.0", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, "..");
    for (const rel of [
      "packages/schema/package.json",
      "packages/core/package.json",
      "apps/cli/package.json",
    ]) {
      const v = JSON.parse(readFileSync(join(root, rel), "utf8")).version;
      expect(v).toBe("0.9.0-rc.0");
    }
  });
});

describe("parseTrustedPublisherList", () => {
  it("parses github / permissions object / array forms", () => {
    const a = parseTrustedPublisherList(
      {
        trustedPublishers: [
          {
            provider: "GitHub Actions",
            repository: "hello-ai-company/ActionManifest",
            workflow_filename: "release.yml",
            environment: "npm-release",
            permissions: { publish: false, stage: true },
          },
        ],
      },
      "@actionmanifest/core",
    );
    expect(a).not.toBe("UNKNOWN");
    expect(a).toHaveLength(1);
    if (a !== "UNKNOWN") {
      expect(a[0]?.org).toBe("hello-ai-company");
      expect(a[0]?.allowPublish).toBe(false);
      expect(a[0]?.allowStagePublish).toBe(true);
    }
  });

  it("returns UNKNOWN when permissions cannot be determined", () => {
    const parsed = parseTrustedPublisherList(
      { provider: "github", repository: "hello-ai-company/ActionManifest", file: "release.yml" },
      "@actionmanifest/core",
    );
    expect(parsed).toBe("UNKNOWN");
  });
});
