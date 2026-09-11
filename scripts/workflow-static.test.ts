import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PINNED_NPM_CLI } from "./release-identity.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const SETUP_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
const UPLOAD = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const DOWNLOAD = "actions/download-artifact@95815c38cf2ff2164869cbab79da8d1f422bc89e";
const PNPM_SETUP = "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1";

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function jobBlock(yaml: string, id: string): string {
  // Do not use the `m` flag with `$` — `$` would match end-of-line and
  // truncate the job after the first body line.
  const re = new RegExp(`(?:^|\\n)(  ${id}:\\n[\\s\\S]*?)(?=\\n  [a-z0-9_-]+:|$)`);
  const m = re.exec(yaml);
  if (!m?.[1]) throw new Error(`job ${id} not found`);
  return m[1];
}

describe("release.yml static asserts", () => {
  const yml = read(".github/workflows/release.yml");

  it("is workflow_dispatch only (no push-tags auto-stage)", () => {
    expect(yml).toMatch(/workflow_dispatch:/);
    expect(yml).not.toMatch(/^on:\n {2}push:/m);
    expect(yml).not.toMatch(/push:\n {4}tags:/);
  });

  it("has stage|verify modes and environment npm-release on the stage job only", () => {
    expect(yml).toMatch(/options: \[stage, verify\]/);
    expect(jobBlock(yml, "stage")).toMatch(/environment: npm-release/);
    expect(jobBlock(yml, "gates")).not.toMatch(/environment:/);
    expect(jobBlock(yml, "verify-registry")).not.toMatch(/environment:/);
  });

  it("fails loudly unless vars.NPM_TRUSTED_PUBLISHING_READY == true (stage)", () => {
    expect(yml).toMatch(/vars\.NPM_TRUSTED_PUBLISHING_READY/);
    expect(yml).toMatch(/FAIL LOUDLY/);
  });

  it("least-privilege OIDC: id-token write only on stage", () => {
    expect(jobBlock(yml, "stage")).toMatch(/id-token: write/);
    expect(jobBlock(yml, "gates")).not.toMatch(/id-token:/);
    expect(jobBlock(yml, "verify-registry")).not.toMatch(/id-token:/);
    expect(jobBlock(yml, "verify-node20")).not.toMatch(/id-token:/);
    expect(jobBlock(yml, "verify-xberg")).not.toMatch(/id-token:/);
  });

  it("stage job is Node+npm+artifacts+OIDC — no pnpm, no cache, no pack", () => {
    const stage = jobBlock(yml, "stage");
    expect(stage).not.toMatch(/uses:\s*pnpm\/action-setup/);
    expect(stage).not.toMatch(/cache:\s*pnpm/);
    expect(stage).not.toMatch(/pnpm install|pnpm pack|npm pack|release:dry-run/);
    expect(stage).toContain("stage-from-artifact.mjs");
    expect(stage).toContain("normalize-canonical-artifact.mjs");
    expect(stage).toContain(`npm@${PINNED_NPM_CLI}`);
  });

  it("stages via npm stage publish and never approves or npm publish", () => {
    expect(yml).toMatch(/npm stage publish/);
    expect(yml).not.toMatch(/^\s+npm stage approve/m);
    expect(yml).not.toMatch(/run:\s*npm stage approve/);
    expect(yml).not.toMatch(/^\s+npm publish /m);
    const stageSrc = read("scripts/stage-from-artifact.mjs");
    expect(stageSrc).toContain('"stage"');
    expect(stageSrc).toContain('"publish"');
    expect(stageSrc).not.toMatch(/npm publish /);
    expect(stageSrc).not.toMatch(/spawnSync\(\s*["']npm["']\s*,\s*\[[^\]]*approve/);
    expect(stageSrc).toMatch(/does not approve/);
  });

  it("does not write a GitHub Release", () => {
    expect(yml).not.toMatch(/softprops\/action-gh-release|gh release create|contents: write/);
  });

  it("keeps immutable action SHA pins", () => {
    expect(yml).toContain(CHECKOUT);
    expect(yml).toContain(SETUP_NODE);
    expect(yml).toContain(UPLOAD);
    expect(yml).toContain(PNPM_SETUP);
  });

  it("empties NPM_TOKEN / NODE_AUTH_TOKEN and fails if present", () => {
    expect(yml).toMatch(/NPM_TOKEN: ""/);
    expect(yml).toMatch(/NODE_AUTH_TOKEN: ""/);
    expect(yml).toMatch(/registry write credentials must never be present/);
  });

  it("pins verify-node20 and verify-xberg checkout to the exact git_sha input", () => {
    for (const id of ["verify-node20", "verify-xberg", "verify-registry", "gates", "stage"]) {
      const job = jobBlock(yml, id);
      expect(job, id).toMatch(/uses:\s*actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
      expect(job, id).toMatch(/ref:\s*\$\{\{\s*github\.event\.inputs\.git_sha\s*\}\}/);
    }
  });

  it("selects a successful FULL Release Check only (never array[0] of any RC)", () => {
    expect(yml).not.toMatch(/\.\[0\]/);
    expect(yml).toContain("select-release-gates.mjs");
    expect(yml).toContain("FULL Release Check");
    const selector = read("scripts/select-release-gates.mjs");
    expect(selector).toContain("FULL_RELEASE_CHECK_NOT_FOUND");
    expect(selector).toContain("pickReleaseGates");
    const helper = read("scripts/full-release-check.mjs");
    expect(helper).toMatch(/event === "pull_request"/);
    expect(helper).toMatch(/push/);
    expect(helper).toMatch(/workflow_dispatch/);
    expect(helper).toContain('name !== "Release Check"');
  });

  it("stages only after normalize then full canonical identity validation", () => {
    const stage = jobBlock(yml, "stage");
    const normalizeAt = stage.indexOf("normalize-canonical-artifact.mjs");
    const validateAt = stage.indexOf("validate-canonical-artifact.mjs");
    const publishAt = stage.indexOf("stage-from-artifact.mjs");
    expect(normalizeAt).toBeGreaterThan(0);
    expect(validateAt).toBeGreaterThan(normalizeAt);
    expect(publishAt).toBeGreaterThan(validateAt);
    expect(stage).toMatch(/--git-sha "\$\{\{ github\.event\.inputs\.git_sha \}\}"/);
    expect(stage).toMatch(/--version "\$\{\{ needs\.gates\.outputs\.version \}\}"/);
    expect(stage).toContain(`gh run download "\${{ needs.gates.outputs.run_id }}"`);
  });
});

describe("release-check.yml static asserts", () => {
  const yml = read(".github/workflows/release-check.yml");

  it("keeps canonical build on ubuntu Node 22 + pnpm", () => {
    const build = jobBlock(yml, "canonical-build");
    expect(build).toContain(PNPM_SETUP);
    expect(build).toMatch(/node-version: 22/);
    expect(build).toMatch(/cache: pnpm/);
    expect(build).toMatch(/name: release-check-\$\{\{ github\.sha \}\}/);
  });

  it("Node20 consumer job uses npm only and excludes adapter-xberg", () => {
    const job = jobBlock(yml, "consumer-node20");
    expect(job).not.toMatch(/uses:\s*pnpm\/action-setup/);
    expect(job).not.toMatch(/cache:\s*pnpm/);
    expect(job).toMatch(/node-version: 20/);
    expect(job).toContain(DOWNLOAD);
    expect(job).toContain("normalize-canonical-artifact.mjs");
    expect(job).toContain("consumer-artifact-smoke.mjs");
    expect(job).toContain("verify-sha256sums.mjs");
  });

  it("Xberg Node22 job is a real Release Check gate on the same artifact", () => {
    const job = jobBlock(yml, "xberg-node22");
    expect(job).toMatch(/node-version: 22/);
    expect(job).toContain("normalize-canonical-artifact.mjs");
    expect(job).toContain("xberg-artifact-smoke.mjs");
    expect(job).toContain("release-check-${{ github.sha }}");
  });

  it("never publishes and pins actions", () => {
    expect(yml).toMatch(/NPM_TOKEN: ""/);
    expect(yml).not.toMatch(/id-token: write/);
    expect(yml).toContain(CHECKOUT);
    expect(yml).toContain(UPLOAD);
  });
});

describe("consumer / xberg smoke scripts", () => {
  it("Node20 smoke excludes adapter-xberg, uses temp cache + prefer-online, never pnpm", () => {
    const src = read("scripts/consumer-artifact-smoke.mjs");
    expect(src).toContain("@actionmanifest/adapter-xberg");
    expect(src).toContain("EXCLUDE");
    expect(src).toContain("--prefer-online");
    expect(src).toContain("npm_config_cache");
    expect(src).not.toMatch(/pnpm install|pnpm pack/);
    expect(src).not.toMatch(/npm_config_userconfig|npm_config_globalconfig/);
    expect(src).toMatch(/65/);
  });

  it("Xberg smoke is a real 2/2 native fixture runner", () => {
    const src = read("scripts/xberg-artifact-smoke.mjs");
    expect(src).toContain("xberg-uri");
    expect(src).toContain("xberg-bytes");
    expect(src).toContain("2/2");
    expect(src).toContain("npm_config_cache");
    expect(src).not.toMatch(/npm_config_userconfig|npm_config_globalconfig/);
    expect(src).not.toMatch(/createRequire/);
    expect(src).toContain("pathToFileURL");
    expect(src).toContain("--prefer-online");
  });
});
