import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import {
  parseSetupArgs,
  parseSetupCli,
  runReleaseSetup,
  type SetupDeps,
} from "./release-setup.js";
import type { GitHubControlPlaneClient } from "./release-setup-github.js";
import { agentSafeNpm, isForbiddenNpmArgv, type NpmTrustClient } from "./release-setup-npm.js";
import {
  RELEASE_ENVIRONMENT_NAME,
  RELEASE_REPO_SLUG,
  RELEASE_RULESET_NAME,
  containsForbiddenSecret,
  desiredControlPlane,
  emptyEnvironmentActual,
  planAgentControlPlaneCheck,
  planReleaseControlPlane,
  type AgentCheckContext,
  type ActualControlPlane,
  type GitHubEnvironmentActual,
  type PackageSecurityActual,
  type ReadyVariableActual,
  type RepoIdentityActual,
  type RulesetSnapshot,
  type TagRulesetActual,
  type TrustedPublisherActual,
} from "./release-setup-plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const realWorkflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");

const expectedPublisher = desiredControlPlane().trustedPublisher;

function productionTagRuleset(id = 42): RulesetSnapshot {
  return {
    id,
    name: RELEASE_RULESET_NAME,
    target: "tag",
    enforcement: "active",
    include: ["refs/tags/v*"],
    rules: ["deletion", "update", "non_fast_forward"],
    ruleObjects: [{ type: "deletion" }, { type: "update" }, { type: "non_fast_forward" }],
  };
}

function okEnv(): GitHubEnvironmentActual {
  return emptyEnvironmentActual({
    exists: true,
    name: RELEASE_ENVIRONMENT_NAME,
    deploymentBranches: ["main"],
    waitTimer: 0,
    preventSelfReview: false,
    deploymentBranchPolicy: { protected_branches: false, custom_branch_policies: true },
    secretsReadStatus: "OK",
    branchPoliciesReadStatus: "OK",
    status: "OK",
  });
}

function matchCtx(overrides: Partial<AgentCheckContext> = {}): AgentCheckContext {
  return {
    fingerprintSha256: "aa".repeat(32),
    expectedSha256: "aa".repeat(32),
    fingerprintMatch: true,
    drift: null,
    driftReason: "LIVE AUDIT REQUIRED",
    ...overrides,
  };
}

function agentActual(partial: Partial<ActualControlPlane> = {}): ActualControlPlane {
  return {
    repo: { slug: RELEASE_REPO_SLUG, verified: true, status: "OK", notes: [] },
    workflowReferencesEnvironment: true,
    environment: okEnv(),
    ruleset: {
      managed: [productionTagRuleset()],
      unrelated: [{ id: 7, name: "some-other-branch-ruleset" }],
      status: "OK",
      notes: [],
    },
    readyVariable: { exists: true, value: "true", status: "OK", notes: [] },
    trustedPublishers: PUBLIC_PACKAGE_NAMES.map((packageName) => ({
      packageName,
      exists: false,
      status: "NOT_QUERIED",
      notes: ["NPM LIVE GOVERNANCE: NOT QUERIED"],
    })),
    packageSecurity: PUBLIC_PACKAGE_NAMES.map((packageName) => ({
      packageName,
      twoFactorRequired: "UNKNOWN",
      longLivedTokensDisallowed: "UNKNOWN",
      trustedPublishingUsed: "UNKNOWN",
      status: "NOT_QUERIED",
      notes: ["NPM LIVE GOVERNANCE: NOT QUERIED"],
    })),
    ...partial,
  };
}

class MemoryGitHub implements GitHubControlPlaneClient {
  writes: string[] = [];
  envExists = true;
  envBranches: string[] = ["main"];
  rulesets: RulesetSnapshot[] = [productionTagRuleset()];
  unrelated = [{ id: 99, name: "do-not-touch-me" }];
  ready: string | null = "true";
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
  }
  async updateEnvironment(): Promise<void> {
    this.writes.push("updateEnvironment");
  }
  async createRuleset(): Promise<void> {
    this.writes.push("createRuleset");
  }
  async updateRuleset(id: number): Promise<void> {
    this.writes.push(`updateRuleset:${id}`);
  }
  async setReadyVariable(): Promise<void> {
    this.writes.push("setReadyVariable");
    this.ready = "true";
  }
}

class CountingNpm implements NpmTrustClient {
  calls: string[] = [];
  writes: string[] = [];

  async inspectCli() {
    this.calls.push("inspectCli");
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
    this.calls.push(`listTrustedPublisher:${packageName}`);
    return {
      packageName,
      exists: true,
      publisher: {
        provider: expectedPublisher.provider,
        org: expectedPublisher.org,
        repo: expectedPublisher.repo,
        workflow: expectedPublisher.workflow,
        environment: expectedPublisher.environment,
        allowStagePublish: true,
        allowPublish: false,
      },
      status: "OK",
      notes: [],
    };
  }
  async addTrustedPublisher(packageName: string): Promise<void> {
    this.calls.push(`addTrustedPublisher:${packageName}`);
    this.writes.push(`addTrustedPublisher:${packageName}`);
  }
  async getPackageSecurity(packageName: string): Promise<PackageSecurityActual> {
    this.calls.push(`getPackageSecurity:${packageName}`);
    return {
      packageName,
      twoFactorRequired: true,
      longLivedTokensDisallowed: true,
      trustedPublishingUsed: true,
      status: "OK",
      notes: [],
    };
  }
  async applyAutomatableSecurity(packageName: string): Promise<void> {
    this.calls.push(`applyAutomatableSecurity:${packageName}`);
    this.writes.push(`applyAutomatableSecurity:${packageName}`);
  }
}

function deps(github: MemoryGitHub, npm: CountingNpm): { deps: SetupDeps; logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    deps: {
      github,
      npm,
      readWorkflow: () => realWorkflow,
      log: (line) => logs.push(line),
      paceTrustedPublisherWrites: async () => {},
    },
  };
}

describe("parseSetupArgs two-layer modes", () => {
  it("keeps --check as the full live default and does not alias it to check-agent", () => {
    expect(parseSetupArgs([])).toBe("check");
    expect(parseSetupArgs(["--check"])).toBe("check");
    expect(parseSetupArgs(["--check-agent"])).toBe("check-agent");
    expect(parseSetupArgs(["--audit-live"])).toBe("audit-live");
    expect(parseSetupArgs(["--apply"])).toBe("apply");
    expect(() => parseSetupArgs(["--check", "--check-agent"])).toThrow(/exactly one/);
    expect(() => parseSetupArgs(["--check", "--audit-live"])).toThrow(/exactly one/);
    expect(() => parseSetupArgs(["--check-agent", "--apply"])).toThrow(/exactly one/);
    expect(parseSetupCli(["--check-agent"]).mode).toBe("check-agent");
    expect(parseSetupCli(["--audit-live"]).attestManualSecurity).toBe(false);
  });
});

describe("planAgentControlPlaneCheck", () => {
  it("READY + matching fingerprint + GitHub OK + PR#13 tag read-back → PASS / NOOP / not AUTH_REQUIRED", () => {
    const plan = planAgentControlPlaneCheck(agentActual(), matchCtx());
    expect(plan.verdict).toBe("PASS");
    expect(plan.items.find((i) => i.id === "ruleset")?.action).toBe("NOOP");
    expect(plan.items.find((i) => i.id === "environment")?.action).toBe("NOOP");
    expect(plan.items.find((i) => i.id === "npm-live-governance")?.status).toBe("NOT_QUERIED");
    expect(plan.items.find((i) => i.id === "ready")?.status).toBe("CACHED_OK");
    expect(plan.items.every((i) => i.mutates === false)).toBe(true);
    expect(plan.items.some((i) => i.status === "AUTH_REQUIRED")).toBe(false);
    expect(plan.remainingHuman).toEqual([]);
    expect(plan.notes.join("\n")).toMatch(/NPM LIVE GOVERNANCE: NOT QUERIED/);
  });

  it("READY missing → LIVE AUDIT REQUIRED", () => {
    const plan = planAgentControlPlaneCheck(
      agentActual({ readyVariable: { exists: false, value: null, status: "MISSING", notes: [] } }),
      matchCtx(),
    );
    expect(plan.verdict).toBe("LIVE_AUDIT_REQUIRED");
    expect(plan.items.find((i) => i.id === "ready")?.reason).toBe("LIVE AUDIT REQUIRED");
    expect(plan.items.find((i) => i.id === "environment")?.action).toBe("NOOP");
  });

  it("fingerprint / package-set mismatch → LIVE AUDIT REQUIRED — PACKAGE SET CHANGED", () => {
    const plan = planAgentControlPlaneCheck(
      agentActual(),
      matchCtx({
        fingerprintMatch: false,
        expectedSha256: "bb".repeat(32),
        drift: "PACKAGE_SET_CHANGED",
        driftReason: "LIVE AUDIT REQUIRED — PACKAGE SET CHANGED",
      }),
    );
    expect(plan.verdict).toBe("LIVE_AUDIT_REQUIRED");
    expect(plan.items.find((i) => i.id === "fingerprint")?.reason).toBe(
      "LIVE AUDIT REQUIRED — PACKAGE SET CHANGED",
    );
  });

  it("environment secrets unread (agent token) is NOOP, not AUTH_REQUIRED", () => {
    const env = emptyEnvironmentActual({
      exists: true,
      name: RELEASE_ENVIRONMENT_NAME,
      deploymentBranches: ["main"],
      deploymentBranchPolicy: { protected_branches: false, custom_branch_policies: true },
      secretsReadStatus: "AUTH_REQUIRED",
      branchPoliciesReadStatus: "OK",
      status: "AUTH_REQUIRED",
      notes: ["cannot read environment secrets (401/403) — fail closed"],
    });
    const plan = planAgentControlPlaneCheck(agentActual({ environment: env }), matchCtx());
    expect(plan.items.find((i) => i.id === "environment")?.action).toBe("NOOP");
    expect(plan.items.find((i) => i.id === "environment")?.status).toBe("OK");
    expect(plan.items.some((i) => i.status === "AUTH_REQUIRED")).toBe(false);
    expect(plan.verdict).toBe("PASS");
  });

  it("READY unreadable is LIVE AUDIT REQUIRED, not AUTH_REQUIRED", () => {
    const plan = planAgentControlPlaneCheck(
      agentActual({
        readyVariable: {
          exists: false,
          value: null,
          status: "AUTH_REQUIRED",
          notes: ["cannot read repository variable"],
        },
      }),
      matchCtx(),
    );
    expect(plan.verdict).toBe("LIVE_AUDIT_REQUIRED");
    expect(plan.items.find((i) => i.id === "ready")?.status).toBe("LIVE_AUDIT_REQUIRED");
    expect(plan.items.some((i) => i.status === "AUTH_REQUIRED")).toBe(false);
  });

  it("GitHub drift (missing environment) → BLOCKED", () => {
    const plan = planAgentControlPlaneCheck(
      agentActual({
        environment: emptyEnvironmentActual({
          exists: false,
          name: RELEASE_ENVIRONMENT_NAME,
          status: "MISSING",
        }),
      }),
      matchCtx(),
    );
    expect(plan.verdict).toBe("BLOCKED");
    expect(plan.items.find((i) => i.id === "environment")?.action).toBe("STOP");
  });

  it("live planner refuses check-agent mode", () => {
    expect(() => planReleaseControlPlane(agentActual(), "check-agent")).toThrow(/planAgentControlPlaneCheck/);
  });
});

describe("runReleaseSetup --check-agent", () => {
  it("does not call npm client / trust list; AUTH_REQUIRED 0; writes 0; READY+match → PASS", async () => {
    const github = new MemoryGitHub();
    const npm = new CountingNpm();
    const { deps: d, logs } = deps(github, npm);
    const result = await runReleaseSetup("check-agent", d);
    expect(npm.calls).toEqual([]);
    expect(npm.writes).toEqual([]);
    expect(github.writes).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(result.plan.verdict).toBe("PASS");
    expect(result.report.npm_live_governance).toBe("NOT_QUERIED");
    expect(result.report.items.some((i) => i.status === "AUTH_REQUIRED")).toBe(false);
    expect(result.report.remaining_human).toEqual([]);
    expect(result.plan.items.find((i) => i.id === "ruleset")?.action).toBe("NOOP");
    expect(logs.join("\n")).toMatch(/NPM LIVE GOVERNANCE: NOT QUERIED/);
    expect(logs.join("\n")).toMatch(/Human action required: none/);
    expect(containsForbiddenSecret(JSON.stringify(result.report))).toBe(false);
  });

  it("READY missing → LIVE AUDIT REQUIRED; still no npm calls", async () => {
    const github = new MemoryGitHub();
    github.ready = null;
    const npm = new CountingNpm();
    const result = await runReleaseSetup("check-agent", deps(github, npm).deps);
    expect(result.plan.verdict).toBe("LIVE_AUDIT_REQUIRED");
    expect(npm.calls).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(result.report.npm_live_governance).toBe("NOT_QUERIED");
  });

  it("GitHub drift → BLOCKED without querying npm", async () => {
    const github = new MemoryGitHub();
    github.envExists = false;
    github.envBranches = [];
    const npm = new CountingNpm();
    const result = await runReleaseSetup("check-agent", deps(github, npm).deps);
    expect(result.plan.verdict).toBe("BLOCKED");
    expect(result.plan.items.find((i) => i.id === "environment")?.action).toBe("STOP");
    expect(npm.calls).toEqual([]);
  });

  it("check-agent cannot invoke trust writes / publish / stage / approve", async () => {
    const refuse = agentSafeNpm();
    await expect(refuse.listTrustedPublisher("@actionmanifest/core")).rejects.toThrow(/trust list/);
    await expect(refuse.addTrustedPublisher("@actionmanifest/core")).rejects.toThrow(/trust github/);
    await expect(refuse.applyAutomatableSecurity("@actionmanifest/core")).rejects.toThrow(/security write/);
    await expect(refuse.inspectCli()).rejects.toThrow(/inspectCli/);
    expect(isForbiddenNpmArgv(["trust", "github", "pkg", "--otp", "123456"])).toBe(true);
    expect(isForbiddenNpmArgv(["stage", "approve", "id"])).toBe(true);
    expect(isForbiddenNpmArgv(["publish", "pkg.tgz"])).toBe(true);
    const src = readFileSync(join(here, "release-setup.ts"), "utf8");
    expect(src).not.toMatch(/--otp/);
    expect(src).not.toMatch(/npm publish /);
    expect(src).not.toMatch(/stage approve/);
  });
});

describe("runReleaseSetup --audit-live / --check live path", () => {
  it("--check still queries npm (not silently agent-only)", async () => {
    const github = new MemoryGitHub();
    const npm = new CountingNpm();
    const result = await runReleaseSetup("check", deps(github, npm).deps);
    expect(npm.calls.some((c) => c.startsWith("listTrustedPublisher:"))).toBe(true);
    expect(npm.calls.some((c) => c.startsWith("getPackageSecurity:"))).toBe(true);
    expect(result.report.npm_live_governance).toBe("QUERIED");
    expect(result.writes).toEqual([]);
  });

  it("--audit-live without auth-shaped discovery stays live and can surface AUTH_REQUIRED", async () => {
    const github = new MemoryGitHub();
    const npm = new CountingNpm();
    const orig = npm.listTrustedPublisher.bind(npm);
    npm.listTrustedPublisher = async (packageName: string) => {
      npm.calls.push(`listTrustedPublisher:${packageName}`);
      return {
        packageName,
        exists: false,
        status: "AUTH_REQUIRED",
        notes: ["BLOCKED — NPM HUMAN AUTH REQUIRED"],
      };
    };
    const result = await runReleaseSetup("audit-live", deps(github, npm).deps);
    expect(result.report.npm_live_governance).toBe("QUERIED");
    expect(result.plan.items.some((i) => i.status === "AUTH_REQUIRED")).toBe(true);
    expect(result.plan.verdict).toBe("BLOCKED");
    npm.listTrustedPublisher = orig;
  });

  it("TP missing on live audit is CREATE/MISSING (drift), not agent NOT_QUERIED", async () => {
    const github = new MemoryGitHub();
    github.ready = null;
    const npm = new CountingNpm();
    npm.listTrustedPublisher = async (packageName: string) => {
      npm.calls.push(`listTrustedPublisher:${packageName}`);
      return { packageName, exists: false, status: "MISSING", notes: [] };
    };
    const result = await runReleaseSetup("audit-live", deps(github, npm).deps);
    const tps = result.plan.items.filter((i) => i.id.startsWith("tp:"));
    expect(tps.every((i) => i.status === "MISSING")).toBe(true);
    expect(tps[0]?.action).toBe("CREATE");
    expect(result.report.npm_live_governance).toBe("QUERIED");
  });
});
