import { describe, expect, it } from "vitest";
import {
  GhControlPlaneClient,
  buildEnvironmentPutBody,
  classifyGhReadFailure,
  parseEnvironmentDiscovery,
  parseRulesetDetail,
  planEnvironmentWrite,
  type GhApiResult,
} from "./release-setup-github.js";
import {
  DESIRED_RULESET_RULE_OBJECTS,
  RELEASE_ENVIRONMENT_NAME,
  RELEASE_RULESET_NAME,
  assessManagedRuleset,
  desiredRulesetPayload,
  emptyEnvironmentActual,
} from "./release-setup-plan.js";

function result(status: number, json: unknown = null, ok = status >= 200 && status < 300): GhApiResult {
  return { ok, status, stdout: json ? JSON.stringify(json) : "", stderr: "", json };
}

describe("classifyGhReadFailure", () => {
  it("maps 401/403 to AUTH_REQUIRED and everything else to UNKNOWN", () => {
    expect(classifyGhReadFailure(401)).toBe("AUTH_REQUIRED");
    expect(classifyGhReadFailure(403)).toBe("AUTH_REQUIRED");
    expect(classifyGhReadFailure(500)).toBe("UNKNOWN");
    expect(classifyGhReadFailure(null)).toBe("UNKNOWN");
  });
});

describe("parseEnvironmentDiscovery fail-closed", () => {
  const envOk = result(200, {
    name: RELEASE_ENVIRONMENT_NAME,
    protection_rules: [
      { type: "wait_timer", wait_timer: 15 },
      {
        type: "required_reviewers",
        prevent_self_review: true,
        reviewers: [{ type: "User", reviewer: { id: 99, type: "User" } }],
      },
    ],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  });

  it("secret 403 is AUTH_REQUIRED STOP — not secretNames=[] OK", () => {
    const actual = parseEnvironmentDiscovery(
      RELEASE_ENVIRONMENT_NAME,
      envOk,
      result(403, null, false),
      result(200, { branch_policies: [{ name: "main" }] }),
    );
    expect(actual.status).toBe("AUTH_REQUIRED");
    expect(actual.secretsReadStatus).toBe("AUTH_REQUIRED");
    expect(actual.secretNames).toEqual([]);
    expect(planEnvironmentWrite(actual).kind).toBe("STOP");
  });

  it("secret 500 is UNKNOWN STOP — not OK", () => {
    const actual = parseEnvironmentDiscovery(
      RELEASE_ENVIRONMENT_NAME,
      envOk,
      result(500, null, false),
      result(200, { branch_policies: [{ name: "main" }] }),
    );
    expect(actual.status).toBe("UNKNOWN");
    expect(actual.secretsReadStatus).toBe("UNKNOWN");
    expect(planEnvironmentWrite(actual).kind).toBe("STOP");
  });

  it("branch-policy 403 is AUTH_REQUIRED STOP — not empty-array UPDATE", () => {
    const actual = parseEnvironmentDiscovery(
      RELEASE_ENVIRONMENT_NAME,
      envOk,
      result(200, { secrets: [] }),
      result(403, null, false),
    );
    expect(actual.status).toBe("AUTH_REQUIRED");
    expect(actual.branchPoliciesReadStatus).toBe("AUTH_REQUIRED");
    expect(actual.deploymentBranches).toEqual([]);
    expect(planEnvironmentWrite(actual).kind).toBe("STOP");
  });

  it("branch-policy 500 is UNKNOWN STOP", () => {
    const actual = parseEnvironmentDiscovery(
      RELEASE_ENVIRONMENT_NAME,
      envOk,
      result(200, { secrets: [] }),
      result(500, null, false),
    );
    expect(actual.status).toBe("UNKNOWN");
    expect(planEnvironmentWrite(actual).kind).toBe("STOP");
  });

  it("captures wait_timer, reviewers, prevent_self_review, branch policies", () => {
    const actual = parseEnvironmentDiscovery(
      RELEASE_ENVIRONMENT_NAME,
      envOk,
      result(200, { secrets: [] }),
      result(200, { branch_policies: [{ name: "main" }, { name: "hotfix" }] }),
    );
    expect(actual.status).toBe("OK");
    expect(actual.waitTimer).toBe(15);
    expect(actual.preventSelfReview).toBe(true);
    expect(actual.requiredReviewers).toEqual([{ type: "User", id: 99 }]);
    expect(actual.deploymentBranches).toEqual(["main", "hotfix"]);
    expect(actual.deploymentBranchPolicy?.custom_branch_policies).toBe(true);
  });
});

describe("environment write preservation", () => {
  it("adding main does not PUT and does not delete other branch policies", () => {
    const actual = emptyEnvironmentActual({
      exists: true,
      status: "OK",
      deploymentBranches: ["release", "hotfix"],
      waitTimer: 30,
      preventSelfReview: true,
      requiredReviewers: [{ type: "Team", id: 7 }],
      requiredReviewerCount: 1,
      deploymentBranchPolicy: { protected_branches: false, custom_branch_policies: true },
      secretsReadStatus: "OK",
      branchPoliciesReadStatus: "OK",
    });
    const planned = planEnvironmentWrite(actual);
    expect(planned.kind).toBe("POST_BRANCH_ONLY");
  });

  it("PUT preserves wait_timer / reviewers / prevent_self_review (never wait_timer:0 wipe)", () => {
    const actual = emptyEnvironmentActual({
      exists: true,
      status: "OK",
      deploymentBranches: ["main"],
      waitTimer: 30,
      preventSelfReview: true,
      requiredReviewers: [{ type: "User", id: 1 }],
      requiredReviewerCount: 1,
      deploymentBranchPolicy: { protected_branches: true, custom_branch_policies: false },
      secretsReadStatus: "OK",
      branchPoliciesReadStatus: "OK",
      protectionMetadataRepresentable: true,
    });
    const planned = planEnvironmentWrite(actual);
    expect(planned.kind).toBe("PUT_THEN_POST");
    if (planned.kind === "PUT_THEN_POST") {
      expect(planned.putBody.wait_timer).toBe(30);
      expect(planned.putBody.prevent_self_review).toBe(true);
      expect(planned.putBody.reviewers).toEqual([{ type: "User", id: 1 }]);
      expect(planned.putBody).toEqual(buildEnvironmentPutBody(actual));
    }
  });
});

describe("GhControlPlaneClient mutation recording", () => {
  it("POST main keeps existing branch policies; no DELETE", async () => {
    const calls: { args: string[]; body?: unknown }[] = [];
    const exec = (args: string[], body?: unknown): GhApiResult => {
      calls.push({ args, body });
      const joined = args.join(" ");
      if (args.includes("GET") && joined.includes(`/environments/${RELEASE_ENVIRONMENT_NAME}`) && !joined.includes("secrets") && !joined.includes("deployment-branch-policies")) {
        return result(200, {
          name: RELEASE_ENVIRONMENT_NAME,
          protection_rules: [{ type: "wait_timer", wait_timer: 15 }],
          deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
        });
      }
      if (joined.includes("/secrets")) return result(200, { secrets: [] });
      if (joined.includes("/deployment-branch-policies") && args.includes("GET")) {
        return result(200, { branch_policies: [{ name: "release" }, { name: "hotfix" }] });
      }
      if (joined.includes("/deployment-branch-policies") && args.includes("POST")) {
        return result(200, { name: "main", type: "branch" });
      }
      return result(200, {});
    };
    const client = new GhControlPlaneClient(exec);
    await client.updateEnvironment();
    expect(calls.some((c) => c.args.includes("DELETE"))).toBe(false);
    const puts = calls.filter((c) => c.args.includes("PUT") && c.args.join(" ").includes("/environments/"));
    expect(puts).toHaveLength(0);
    const posts = calls.filter((c) => c.args.includes("POST") && c.args.join(" ").includes("deployment-branch-policies"));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ name: "main", type: "branch" });
  });

  it("create/update ruleset bodies include update_allows_fetch_and_merge and do not touch unrelated names", async () => {
    const calls: { args: string[]; body?: unknown }[] = [];
    const exec = (args: string[], body?: unknown): GhApiResult => {
      calls.push({ args, body });
      const joined = args.join(" ");
      if (args.includes("GET") && /\/rulesets\/9\b/.test(joined)) {
        return result(200, {
          id: 9,
          name: RELEASE_RULESET_NAME,
          target: "tag",
          enforcement: "active",
          conditions: { ref_name: { include: ["refs/tags/v*"] } },
          rules: [
            { type: "deletion" },
            { type: "required_signatures" },
          ],
        });
      }
      return result(200, {});
    };
    const client = new GhControlPlaneClient(exec);
    await client.createRuleset();
    await client.updateRuleset(9);
    const create = calls.find((c) => c.args.includes("POST") && /\/rulesets(?!\/)/.test(c.args.join(" ")));
    const update = calls.find((c) => c.args.includes("PUT") && /\/rulesets\/9\b/.test(c.args.join(" ")));
    expect(create?.body).toEqual(desiredRulesetPayload());
    const createRules = (create?.body as { rules: { type: string; parameters?: { update_allows_fetch_and_merge?: boolean } }[] }).rules;
    expect(createRules.find((r) => r.type === "update")?.parameters?.update_allows_fetch_and_merge).toBe(false);
    const updateRules = (update?.body as { rules: { type: string }[] }).rules;
    expect(updateRules.some((r) => r.type === "required_signatures")).toBe(true);
    expect(updateRules.some((r) => r.type === "non_fast_forward")).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("do-not-touch-me");
  });

  it("ruleset detail GET 403 after list is AUTH_REQUIRED, not DRIFTED from {}", async () => {
    const exec = (args: string[]): GhApiResult => {
      const path = args[args.length - 1] ?? "";
      if (path.endsWith("/rulesets") && args.includes("GET")) {
        return result(200, [{ id: 3, name: RELEASE_RULESET_NAME }]);
      }
      if (/\/rulesets\/3$/.test(path)) return result(403, null, false);
      return result(200, []);
    };
    const listed = await new GhControlPlaneClient(exec).listRulesets();
    expect(listed.status).toBe("AUTH_REQUIRED");
    expect(listed.managed).toEqual([]);
  });

  it("ruleset detail GET 500 after list is UNKNOWN, not ordinary DRIFTED", async () => {
    const exec = (args: string[]): GhApiResult => {
      const path = args[args.length - 1] ?? "";
      if (path.endsWith("/rulesets") && args.includes("GET")) {
        return result(200, [{ id: 3, name: RELEASE_RULESET_NAME }]);
      }
      if (/\/rulesets\/3$/.test(path)) return result(500, null, false);
      return result(200, []);
    };
    const listed = await new GhControlPlaneClient(exec).listRulesets();
    expect(listed.status).toBe("UNKNOWN");
    expect(listed.managed).toEqual([]);
  });
});

describe("parseRulesetDetail", () => {
  it("keeps update parameters", () => {
    const snap = parseRulesetDetail(1, RELEASE_RULESET_NAME, {
      target: "tag",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/tags/v*"] } },
      rules: DESIRED_RULESET_RULE_OBJECTS,
    });
    expect(snap.ruleObjects.find((r) => r.type === "update")?.parameters?.update_allows_fetch_and_merge).toBe(
      false,
    );
  });

  it("production-shape tag read-back omits update.parameters and still MATCH / write still sends param", () => {
    const snap = parseRulesetDetail(1, RELEASE_RULESET_NAME, {
      name: RELEASE_RULESET_NAME,
      target: "tag",
      enforcement: "active",
      conditions: { ref_name: { exclude: [], include: ["refs/tags/v*"] } },
      rules: [{ type: "deletion" }, { type: "update" }, { type: "non_fast_forward" }],
    });
    expect(snap.ruleObjects.find((r) => r.type === "update")).toEqual({ type: "update" });
    expect(snap.ruleObjects.find((r) => r.type === "update")?.parameters).toBeUndefined();
    expect(assessManagedRuleset(snap).kind).toBe("MATCH");
    expect(desiredRulesetPayload().rules.find((r) => r.type === "update")?.parameters?.update_allows_fetch_and_merge).toBe(
      false,
    );
  });
});
