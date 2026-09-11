import { describe, expect, it } from "vitest";
import {
  PINNED_NPM_CLI,
  RC0_HISTORICAL_LATEST,
  assertDeterministicIdentity,
  assertVersionTagPairing,
  buildReleaseIdentity,
  distTagForVersion,
  isPrerelease,
  node20ConsumerPackages,
  stagePublishCommand,
} from "./release-identity.js";

const packages = [
  "@actionmanifest/schema",
  "@actionmanifest/core",
  "@actionmanifest/temporal",
  "@actionmanifest/adapters",
  "@actionmanifest/extractor",
  "@actionmanifest/verifier",
  "@actionmanifest/exporters",
  "@actionmanifest/consumer",
  "@actionmanifest/adapter-xberg",
  "@actionmanifest/cli",
].map((name) => ({
  name,
  version: "0.9.0-rc.0",
  tarball: `tarballs/actionmanifest-${name.split("/")[1]}-0.9.0-rc.0.tgz`,
  sha256: "ab".repeat(32),
}));

const baseInput = {
  version: "0.9.0-rc.0",
  git_sha: "c0030b71e7497eb7e53b9348fa7101733f025b85",
  git_tree: "918112608e35ba5d59cc47302324f71263280848",
  package_manager: "pnpm@11.23.0",
  node_version: "v22.18.0",
  platform: "linux",
  publish_order: packages.map((p) => p.name),
  packages,
};

describe("dist-tag policy", () => {
  it("maps prerelease versions to next", () => {
    expect(isPrerelease("0.9.0-rc.0")).toBe(true);
    expect(distTagForVersion("0.9.0-rc.0")).toBe("next");
    expect(distTagForVersion("1.0.0-beta.1")).toBe("next");
  });

  it("maps stable versions to latest", () => {
    expect(isPrerelease("0.9.0")).toBe(false);
    expect(distTagForVersion("0.9.0")).toBe("latest");
    expect(distTagForVersion("1.2.3")).toBe("latest");
  });

  it("rejects latest on a prerelease and next on a stable", () => {
    expect(() => assertVersionTagPairing("0.9.0-rc.0", "latest")).toThrow(/pairing/);
    expect(() => assertVersionTagPairing("0.9.0", "next")).toThrow(/pairing/);
    expect(() => assertVersionTagPairing("0.9.0-rc.0", "next")).not.toThrow();
    expect(() => assertVersionTagPairing("0.9.0", "latest")).not.toThrow();
  });

  it("stage commands use npm stage publish (never npm publish) and the policy tag", () => {
    const rc = stagePublishCommand("./release-artifacts/tarballs/a.tgz", "0.9.0-rc.0");
    expect(rc).toContain("npm stage publish");
    expect(rc).not.toMatch(/npm publish /);
    expect(rc).toContain("--tag next");
    expect(rc).toContain("--registry https://registry.npmjs.org/");
    const stable = stagePublishCommand("./release-artifacts/tarballs/a.tgz", "0.9.0");
    expect(stable).toContain("--tag latest");
  });

  it("records the rc.0 latest observation as documentation, not a mutation target", () => {
    expect(RC0_HISTORICAL_LATEST).toBe("0.9.0-rc.0");
  });

  it("pins npm CLI 11.15.0 (Trusted Publishing minimum 11.5.1; already used)", () => {
    expect(PINNED_NPM_CLI).toBe("11.15.0");
  });
});

describe("buildReleaseIdentity", () => {
  it("emits only deterministic identity fields", () => {
    const id = buildReleaseIdentity(baseInput);
    expect(id.version).toBe("0.9.0-rc.0");
    expect(id.git_sha).toBe(baseInput.git_sha);
    expect(id.git_tree).toBe(baseInput.git_tree);
    expect(id.package_manager).toBe("pnpm@11.23.0");
    expect(id.node_version).toBe("v22.18.0");
    expect(id.platform).toBe("linux");
    expect(id.packages).toHaveLength(10);
    expect(id.publish_order).toEqual(baseInput.publish_order);
    assertDeterministicIdentity(id as unknown as Record<string, unknown>);
    expect(JSON.stringify(id)).not.toMatch(/generated_at|timestamp|hostname|run_id/i);
  });

  it("rejects the wrong package count or lockstep mismatch", () => {
    expect(() =>
      buildReleaseIdentity({ ...baseInput, packages: baseInput.packages.slice(0, 9) }),
    ).toThrow(/expected 10/);
    expect(() => buildReleaseIdentity({ ...baseInput, version: "0.9.0-rc.1" })).toThrow(
      /lockstep/,
    );
  });
});

describe("node20 consumer exclusions", () => {
  it("excludes adapter-xberg and keeps the other 9 packages", () => {
    const names = node20ConsumerPackages();
    expect(names).not.toContain("@actionmanifest/adapter-xberg");
    expect(names).toHaveLength(9);
    expect(names).toContain("@actionmanifest/cli");
    expect(names).toContain("@actionmanifest/core");
  });
});
