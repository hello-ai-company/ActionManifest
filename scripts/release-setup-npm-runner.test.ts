import { describe, expect, it } from "vitest";
import { PINNED_NPM_CLI } from "./release-identity.js";
import { OfficialNpmTrustClient } from "./release-setup-npm.js";
import {
  PINNED_NPM_PACKAGE_SPEC,
  isExactPinnedNpmSpec,
  pinnedNpmInvocation,
  resolvePinnedNpm,
} from "./release-setup-npm-runner.js";

describe("pinned npm runner", () => {
  it("never selects host 10.x and never uses a floating latest spec", () => {
    const resolved = resolvePinnedNpm({
      hostNpmVersion: "10.9.7",
      env: {},
      repoRoot: "/tmp/does-not-contain-actionmanifest-npm",
    });
    expect(resolved.version).toBe("11.15.0");
    expect(resolved.version).toBe(PINNED_NPM_CLI);
    expect(resolved.spec).toBe("npm@11.15.0");
    expect(isExactPinnedNpmSpec(resolved.spec)).toBe(true);
    expect(resolved.spec.includes("latest")).toBe(false);
    const invocation = pinnedNpmInvocation(["--version"], resolved);
    expect(invocation.command).toBe("npx");
    expect(invocation.args).toEqual(["--yes", "--package=npm@11.15.0", "--", "npm", "--version"]);
    expect(invocation.args.join(" ")).not.toContain("npm@latest");
  });

  it("OfficialNpmTrustClient --version is the pinned runner, not host 10.x", async () => {
    const seen: string[][] = [];
    const client = new OfficialNpmTrustClient((args) => {
      seen.push(args);
      if (args[0] === "--version") return { status: 0, stdout: "11.15.0\n", stderr: "" };
      return { status: 0, stdout: "npm trust\ntrust list\ntrust github\n", stderr: "" };
    });
    const caps = await client.inspectCli();
    expect(caps.version).toBe("11.15.0");
    expect(caps.version).not.toBe("10.9.7");
    expect(seen[0]).toEqual(["--version"]);
  });

  it("addTrustedPublisher uses official --yes and never --otp / --allow-publish", async () => {
    let captured: string[] = [];
    const client = new OfficialNpmTrustClient((args) => {
      captured = args;
      if (args[0] === "--version") return { status: 0, stdout: "11.15.0\n", stderr: "" };
      if (args[0] === "help") return { status: 0, stdout: "npm trust\ntrust list\ntrust github\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });
    await client.addTrustedPublisher("@actionmanifest/core");
    expect(captured).toContain("--yes");
    expect(captured).toContain("--allow-stage-publish");
    expect(captured).not.toContain("--otp");
    expect(captured).not.toContain("--allow-publish");
    expect(captured[0]).toBe("trust");
    expect(captured[1]).toBe("github");
  });
});
