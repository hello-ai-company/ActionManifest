import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import {
  DESIRED_RULESET_RULE_OBJECTS,
  RELEASE_ENVIRONMENT_NAME,
  RELEASE_REPO_SLUG,
  RELEASE_RULESET_NAME,
  applyBlocked,
  assertNoSecrets,
  containsForbiddenSecret,
  desiredControlPlane,
  desiredRulesetPayload,
  emptyEnvironmentActual,
  evaluatePrerequisites,
  managedRulesetUpdatePayload,
  mergeManagedRulesetRules,
  mutatingItems,
  planReleaseControlPlane,
  prerequisitesPass,
  publisherMatches,
  redactSecrets,
  securityStatusBlocksReady,
  type ActualControlPlane,
  type GitHubEnvironmentActual,
  type PackageSecurityActual,
  type ReadyVariableActual,
  type RepoIdentityActual,
  type RulesetSnapshot,
  type TagRulesetActual,
  type TrustedPublisherActual,
  type TrustedPublisherRecord,
} from "./release-setup-plan.js";

const desired = desiredControlPlane();

const expectedPublisher: TrustedPublisherRecord = {
  provider: "github",
  org: "hello-ai-company",
  repo: "ActionManifest",
  workflow: "release.yml",
  environment: "npm-release",
  allowStagePublish: true,
  allowPublish: false,
};

function okRepo(): RepoIdentityActual {
  return { slug: RELEASE_REPO_SLUG, verified: true, status: "OK", notes: [] };
}

function okRulesetSnapshot(id = 42): RulesetSnapshot {
  return {
    id,
    name: RELEASE_RULESET_NAME,
    target: "tag",
    enforcement: "active",
    include: ["refs/tags/v*"],
    rules: ["deletion", "update", "non_fast_forward"],
    ruleObjects: DESIRED_RULESET_RULE_OBJECTS.map((r) =>
      r.parameters ? { type: r.type, parameters: { ...r.parameters } } : { type: r.type },
    ),
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

function okRuleset(): TagRulesetActual {
  return {
    managed: [okRulesetSnapshot()],
    unrelated: [{ id: 7, name: "some-other-branch-ruleset" }],
    status: "OK",
    notes: [],
  };
}

function missingEnv(): GitHubEnvironmentActual {
  return emptyEnvironmentActual({
    exists: false,
    name: RELEASE_ENVIRONMENT_NAME,
    status: "MISSING",
  });
}

function missingRuleset(unrelated = okRuleset().unrelated): TagRulesetActual {
  return { managed: [], unrelated, status: "MISSING", notes: [] };
}

function tp(name: string, overrides: Partial<TrustedPublisherActual> = {}): TrustedPublisherActual {
  return {
    packageName: name,
    exists: true,
    publisher: { ...expectedPublisher },
    status: "OK",
    notes: [],
    ...overrides,
  };
}

function missingTp(name: string): TrustedPublisherActual {
  return { packageName: name, exists: false, status: "MISSING", notes: [] };
}

function okSecurity(name: string): PackageSecurityActual {
  return {
    packageName: name,
    twoFactorRequired: true,
    longLivedTokensDisallowed: true,
    trustedPublishingUsed: true,
    status: "OK",
    notes: [],
  };
}

function readyVar(value: string | null): ReadyVariableActual {
  return {
    exists: value !== null,
    value,
    status: value === "true" ? "OK" : "MISSING",
    notes: [],
  };
}

function actual(partial: Partial<ActualControlPlane> = {}): ActualControlPlane {
  return {
    repo: okRepo(),
    workflowReferencesEnvironment: true,
    environment: okEnv(),
    ruleset: okRuleset(),
    readyVariable: readyVar(null),
    trustedPublishers: PUBLIC_PACKAGE_NAMES.map((n) => tp(n)),
    packageSecurity: PUBLIC_PACKAGE_NAMES.map((n) => okSecurity(n)),
    ...partial,
  };
}

describe("desiredControlPlane uses PUBLIC_PACKAGE_NAMES as SoT", () => {
  it("lists the 10 public packages and does not hardcode a second roster", () => {
    expect(desired.packages).toEqual(PUBLIC_PACKAGE_NAMES);
    expect(desired.packages).toHaveLength(10);
    expect(desired.packages).toContain("@actionmanifest/adapter-xberg");
    expect(desired.packages).toContain("@actionmanifest/cli");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "release-setup-plan.ts"), "utf8");
    expect(src).toContain("PUBLIC_PACKAGE_NAMES");
    expect(src).not.toMatch(/@actionmanifest\/schema",\s*"@actionmanifest\/core"/);
  });

  it("the pure module has no I/O or process control", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "release-setup-plan.ts"), "utf8");
    expect(source).not.toMatch(/execFileSync|spawnSync|process\.exit|process\.argv/);
    expect(source).not.toMatch(/readFileSync|writeFileSync|rmSync|mkdirSync/);
    expect(source).not.toMatch(/npm publish /);
    expect(source).not.toMatch(/npm stage approve/);
    expect(source).not.toMatch(/gh release create/);
  });
});

describe("planReleaseControlPlane", () => {
  it("all missing + security MANUAL_REQUIRED → CREATE env/ruleset/TPs but READY is NOT SET", () => {
    const plan = planReleaseControlPlane(
      actual({
        environment: missingEnv(),
        ruleset: missingRuleset(),
        trustedPublishers: PUBLIC_PACKAGE_NAMES.map(missingTp),
        packageSecurity: PUBLIC_PACKAGE_NAMES.map((n) => ({
          packageName: n,
          twoFactorRequired: "UNKNOWN",
          longLivedTokensDisallowed: "UNKNOWN",
          trustedPublishingUsed: false,
          status: "MANUAL_REQUIRED",
          notes: [],
        })),
        readyVariable: readyVar(null),
      }),
    );
    expect(plan.items.find((i) => i.id === "environment")?.action).toBe("CREATE");
    expect(plan.items.find((i) => i.id === "ruleset")?.action).toBe("CREATE");
    const tps = plan.items.filter((i) => i.id.startsWith("tp:"));
    expect(tps).toHaveLength(10);
    expect(tps.every((i) => i.action === "CREATE")).toBe(true);
    expect(plan.items.find((i) => i.id === "ready")?.action).not.toBe("SET_READY");
    expect(mutatingItems(plan).some((i) => i.id === "ready")).toBe(false);
    expect(plan.readyLast).toBe(true);
    expect(plan.verdict).toBe("NOT_READY");
  });

  it("all missing + security OK → CREATE then READY last", () => {
    const plan = planReleaseControlPlane(
      actual({
        environment: missingEnv(),
        ruleset: missingRuleset(),
        trustedPublishers: PUBLIC_PACKAGE_NAMES.map(missingTp),
        packageSecurity: PUBLIC_PACKAGE_NAMES.map((n) => okSecurity(n)),
        readyVariable: readyVar(null),
      }),
    );
    const writes = mutatingItems(plan);
    expect(writes.at(-1)?.id).toBe("ready");
    expect(writes.at(-1)?.action).toBe("SET_READY");
    expect(plan.verdict).toBe("NOT_READY");
  });

  it("all correct including READY=true → NOOP / zero mutations / READY", () => {
    const plan = planReleaseControlPlane(actual({ readyVariable: readyVar("true") }));
    expect(mutatingItems(plan)).toEqual([]);
    expect(plan.items.every((i) => i.action === "NOOP")).toBe(true);
    expect(plan.verdict).toBe("READY");
  });

  it("partial → CREATE missing only", () => {
    const publishers = PUBLIC_PACKAGE_NAMES.map((n, i) => (i < 7 ? tp(n) : missingTp(n)));
    const plan = planReleaseControlPlane(actual({ trustedPublishers: publishers }));
    const creates = plan.items.filter((i) => i.action === "CREATE");
    expect(creates.map((i) => i.resource)).toEqual(PUBLIC_PACKAGE_NAMES.slice(7));
    expect(plan.items.find((i) => i.id === "environment")?.action).toBe("NOOP");
    expect(plan.items.find((i) => i.id === "ruleset")?.action).toBe("NOOP");
  });

  it("wrong Trusted Publisher → DRIFTED / STOP (no overwrite)", () => {
    const publishers = PUBLIC_PACKAGE_NAMES.map((n, i) =>
      i === 0
        ? tp(n, {
            status: "DRIFTED",
            publisher: { ...expectedPublisher, repo: "SomeOtherRepo", workflow: "publish.yml" },
          })
        : tp(n),
    );
    const plan = planReleaseControlPlane(actual({ trustedPublishers: publishers }));
    const bad = plan.items.find((i) => i.id === `tp:${PUBLIC_PACKAGE_NAMES[0]}`);
    expect(bad?.action).toBe("STOP");
    expect(bad?.status).toBe("DRIFTED");
    expect(bad?.reason).toMatch(/SECURITY REVIEW REQUIRED/);
    expect(bad?.mutates).toBe(false);
    expect(applyBlocked(plan)).toBe(true);
    expect(plan.verdict).toBe("BLOCKED");
    expect(plan.items.find((i) => i.id === "ready")?.action).not.toBe("SET_READY");
  });

  it("direct OIDC publish enabled → DRIFTED / STOP", () => {
    const publishers = PUBLIC_PACKAGE_NAMES.map((n, i) =>
      i === 1
        ? tp(n, {
            publisher: { ...expectedPublisher, allowPublish: true, allowStagePublish: true },
          })
        : tp(n),
    );
    const plan = planReleaseControlPlane(actual({ trustedPublishers: publishers }));
    const bad = plan.items.find((i) => i.id === `tp:${PUBLIC_PACKAGE_NAMES[1]}`);
    expect(bad?.action).toBe("STOP");
    expect(bad?.reason).toMatch(/direct registry publish/);
    expect(applyBlocked(plan)).toBe(true);
  });

  it("conflicting same-name rulesets → STOP", () => {
    const plan = planReleaseControlPlane(
      actual({
        ruleset: {
          managed: [
            {
              ...okRulesetSnapshot(1),
              rules: ["deletion"],
              ruleObjects: [{ type: "deletion" }],
            },
            {
              ...okRulesetSnapshot(2),
              rules: ["update"],
              ruleObjects: [{ type: "update", parameters: { update_allows_fetch_and_merge: false } }],
            },
          ],
          unrelated: [],
          status: "DRIFTED",
          notes: [],
        },
      }),
    );
    const rs = plan.items.find((i) => i.id === "ruleset");
    expect(rs?.action).toBe("STOP");
    expect(rs?.reason).toMatch(/multiple rulesets/);
    expect(applyBlocked(plan)).toBe(true);
    expect(plan.verdict).toBe("BLOCKED");
  });

  it("READY=true + incomplete prerequisites → CRITICAL / fail loudly / no auto-false", () => {
    const plan = planReleaseControlPlane(
      actual({
        environment: missingEnv(),
        readyVariable: readyVar("true"),
      }),
    );
    expect(plan.critical.join(" ")).toMatch(/CRITICAL/);
    expect(plan.verdict).toBe("BLOCKED");
    const ready = plan.items.find((i) => i.id === "ready");
    expect(ready?.action).toBe("STOP");
    expect(ready?.mutates).toBe(false);
    expect(ready?.reason).toMatch(/do not auto-flip false/);
  });

  it("READY=false + all OK → SET_READY plan (last write)", () => {
    const plan = planReleaseControlPlane(actual({ readyVariable: readyVar("false") }));
    const writes = mutatingItems(plan);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.action).toBe("SET_READY");
    expect(writes[0]?.order).toBeGreaterThan(
      Math.max(...plan.items.filter((i) => i.id !== "ready").map((i) => i.order)),
    );
    expect(plan.verdict).toBe("NOT_READY");
  });

  it("second apply (everything including READY correct) → zero mutations", () => {
    const first = planReleaseControlPlane(actual({ readyVariable: readyVar("true") }));
    const second = planReleaseControlPlane(actual({ readyVariable: readyVar("true") }));
    expect(mutatingItems(first)).toHaveLength(0);
    expect(mutatingItems(second)).toHaveLength(0);
    expect(second.verdict).toBe("READY");
  });

  it("one TP fail ⇒ not ready and READY is not set", () => {
    const publishers = [...PUBLIC_PACKAGE_NAMES.slice(0, 9).map((n) => tp(n)), missingTp(PUBLIC_PACKAGE_NAMES[9]!)];
    const plan = planReleaseControlPlane(actual({ trustedPublishers: publishers, readyVariable: readyVar(null) }));
    expect(plan.verdict).toBe("NOT_READY");
    const flags = evaluatePrerequisites(
      actual({ trustedPublishers: publishers, readyVariable: readyVar(null) }),
    );
    expect(flags.trustedPublishersOk).toBe(false);
    expect(prerequisitesPass(flags)).toBe(false);
  });

  it("unrelated rulesets are never targeted", () => {
    const plan = planReleaseControlPlane(actual());
    const serialized = JSON.stringify(plan.items.filter((i) => i.mutates));
    expect(serialized).not.toContain("some-other-branch-ruleset");
    expect(plan.items.find((i) => i.id === "ruleset")?.reason).not.toMatch(/some-other/);
  });

  it("required reviewers are optional — zero reviewers is still OK", () => {
    const plan = planReleaseControlPlane(actual());
    expect(plan.items.find((i) => i.id === "environment")?.status).toBe("OK");
    expect(plan.items.find((i) => i.id === "environment")?.reason).toMatch(/optional/);
  });

  it("workflow missing environment: npm-release is CRITICAL", () => {
    const plan = planReleaseControlPlane(actual({ workflowReferencesEnvironment: false }));
    expect(plan.critical.join(" ")).toMatch(/release\.yml/);
    expect(plan.verdict).toBe("BLOCKED");
  });

  it("serialized plan never contains credential-shaped tokens", () => {
    const plan = planReleaseControlPlane(actual({ readyVariable: readyVar("true") }));
    const text = JSON.stringify(plan);
    expect(containsForbiddenSecret(text)).toBe(false);
    expect(() => assertNoSecrets(text)).not.toThrow();
    expect(redactSecrets("Authorization: Bearer supersecret")).not.toMatch(/Bearer supersecret/i);
    expect(redactSecrets("Authorization: Bearer supersecret")).toMatch(/REDACTED/);
  });
});

describe("security contract blocks READY unless OK", () => {
  it("MANUAL_REQUIRED is not PASS and does not SET_READY", () => {
    expect(securityStatusBlocksReady("MANUAL_REQUIRED")).toBe(true);
    const plan = planReleaseControlPlane(
      actual({
        packageSecurity: PUBLIC_PACKAGE_NAMES.map((n) => ({
          packageName: n,
          twoFactorRequired: "UNKNOWN",
          longLivedTokensDisallowed: "UNKNOWN",
          trustedPublishingUsed: true,
          status: "MANUAL_REQUIRED",
          notes: ["UI break-glass"],
        })),
        readyVariable: readyVar(null),
      }),
    );
    expect(plan.items.find((i) => i.id === "ready")?.action).not.toBe("SET_READY");
    expect(["NOT_READY", "BLOCKED"]).toContain(plan.verdict);
    expect(prerequisitesPass(evaluatePrerequisites(actual({
      packageSecurity: PUBLIC_PACKAGE_NAMES.map((n) => ({
        packageName: n,
        twoFactorRequired: "UNKNOWN",
        longLivedTokensDisallowed: "UNKNOWN",
        trustedPublishingUsed: true,
        status: "MANUAL_REQUIRED",
        notes: [],
      })),
    })))).toBe(false);
  });

  it("UNSUPPORTED is not PASS and does not SET_READY", () => {
    expect(securityStatusBlocksReady("UNSUPPORTED")).toBe(true);
    const plan = planReleaseControlPlane(
      actual({
        packageSecurity: PUBLIC_PACKAGE_NAMES.map((n) => ({
          packageName: n,
          twoFactorRequired: "UNKNOWN",
          longLivedTokensDisallowed: "UNKNOWN",
          trustedPublishingUsed: "UNKNOWN",
          status: "UNSUPPORTED",
          notes: ["CLI cannot express token-disallow"],
        })),
        readyVariable: readyVar(null),
      }),
    );
    expect(plan.items.find((i) => i.id === "ready")?.action).not.toBe("SET_READY");
    expect(["NOT_READY", "BLOCKED"]).toContain(plan.verdict);
  });

  it("READY=true + MANUAL_REQUIRED → CRITICAL / BLOCKED", () => {
    const plan = planReleaseControlPlane(
      actual({
        packageSecurity: PUBLIC_PACKAGE_NAMES.map((n) => ({
          packageName: n,
          twoFactorRequired: "UNKNOWN",
          longLivedTokensDisallowed: "UNKNOWN",
          trustedPublishingUsed: true,
          status: "MANUAL_REQUIRED",
          notes: [],
        })),
        readyVariable: readyVar("true"),
      }),
    );
    expect(plan.critical.join(" ")).toMatch(/CRITICAL/);
    expect(plan.verdict).toBe("BLOCKED");
    expect(plan.items.find((i) => i.id === "ready")?.action).toBe("STOP");
    expect(plan.items.find((i) => i.id === "ready")?.mutates).toBe(false);
  });
});

describe("desiredRulesetPayload", () => {
  it("emits explicit rule objects with required update parameters", () => {
    const body = desiredRulesetPayload();
    expect(body.name).toBe(RELEASE_RULESET_NAME);
    expect(body.target).toBe("tag");
    expect(body.enforcement).toBe("active");
    expect(body.conditions.ref_name.include).toEqual(["refs/tags/v*"]);
    expect(body.rules).toEqual([
      { type: "deletion" },
      { type: "update", parameters: { update_allows_fetch_and_merge: false } },
      { type: "non_fast_forward" },
    ]);
    const update = body.rules.find((r) => r.type === "update");
    expect(update?.parameters?.update_allows_fetch_and_merge).toBe(false);
    expect(JSON.stringify(body.rules)).not.toBe(JSON.stringify(body.rules.map((r) => ({ type: r.type }))));
  });

  it("preserves compatible stronger extra rules and never weakens update", () => {
    const merged = mergeManagedRulesetRules([
      { type: "deletion" },
      { type: "update", parameters: { update_allows_fetch_and_merge: true } },
      { type: "required_signatures" },
    ]);
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.rules.find((r) => r.type === "required_signatures")).toEqual({ type: "required_signatures" });
      expect(merged.rules.find((r) => r.type === "update")?.parameters?.update_allows_fetch_and_merge).toBe(false);
      expect(merged.rules.find((r) => r.type === "non_fast_forward")).toEqual({ type: "non_fast_forward" });
    }
    const extraOk = planReleaseControlPlane(
      actual({
        ruleset: {
          managed: [
            {
              ...okRulesetSnapshot(),
              rules: ["deletion", "update", "non_fast_forward", "required_signatures"],
              ruleObjects: [
                ...okRulesetSnapshot().ruleObjects,
                { type: "required_signatures" },
              ],
            },
          ],
          unrelated: [{ id: 7, name: "some-other-branch-ruleset" }],
          status: "OK",
          notes: [],
        },
      }),
    );
    expect(extraOk.items.find((i) => i.id === "ruleset")?.action).toBe("NOOP");
  });

  it("update payload does not target unrelated rulesets", () => {
    const payload = managedRulesetUpdatePayload(okRulesetSnapshot(42));
    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.body.name).toBe(RELEASE_RULESET_NAME);
      expect(JSON.stringify(payload.body)).not.toContain("some-other-branch-ruleset");
    }
  });
});

describe("publisherMatches", () => {
  it("accepts GitHub Actions aliases and rejects identity drift", () => {
    expect(publisherMatches({ ...expectedPublisher, provider: "GitHub Actions" }, desired.trustedPublisher)).toBe(
      true,
    );
    expect(publisherMatches({ ...expectedPublisher, repo: "other" }, desired.trustedPublisher)).toBe(false);
    expect(publisherMatches({ ...expectedPublisher, allowPublish: true }, desired.trustedPublisher)).toBe(false);
  });
});
