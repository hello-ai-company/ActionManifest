import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertProtectedReleaseTag,
  distTagForVersion,
  isPrerelease,
  parseProtectedReleaseTag,
  parseSemver,
} from "./semver.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("shared SemVer parser", () => {
  it("parses stable and prerelease without includes('-')", () => {
    expect(parseSemver("1.0.0")?.prerelease).toBeNull();
    expect(parseSemver("0.9.0-rc.1")?.prerelease).toBe("rc.1");
    expect(parseSemver("0.9.0-rc.1")).toMatchObject({ major: 0, minor: 9, patch: 0 });
    expect(parseSemver("0.9")).toBeNull();
    expect(parseSemver("foo")).toBeNull();
    expect(parseSemver("01.0.0")).toBeNull();
  });

  it("isPrerelease uses the parser and rejects invalid versions", () => {
    expect(isPrerelease("0.9.0-rc.1")).toBe(true);
    expect(isPrerelease("1.0.0")).toBe(false);
    expect(() => isPrerelease("not-a-version")).toThrow(/not a valid semver/);
    expect(() => isPrerelease("1.0.0-")).toThrow(/not a valid semver/);
  });
});

describe("protected v* release tag contract", () => {
  it("v0.9.0-rc.1 => next", () => {
    const parsed = parseProtectedReleaseTag("v0.9.0-rc.1");
    expect(parsed?.version).toBe("0.9.0-rc.1");
    expect(parsed?.distTag).toBe("next");
    expect(distTagForVersion(parsed!.version)).toBe("next");
  });

  it("v1.0.0 => latest", () => {
    const parsed = parseProtectedReleaseTag("v1.0.0");
    expect(parsed?.version).toBe("1.0.0");
    expect(parsed?.distTag).toBe("latest");
    expect(distTagForVersion(parsed!.version)).toBe("latest");
  });

  it("rejects a bare semver without the protected v prefix", () => {
    expect(parseProtectedReleaseTag("0.9.0-rc.1")).toBeNull();
    expect(() => assertProtectedReleaseTag("0.9.0-rc.1")).toThrow(/v<valid-semver>/);
  });

  it("rejects unprotected or malformed tags", () => {
    expect(parseProtectedReleaseTag("release-0.9.0")).toBeNull();
    expect(parseProtectedReleaseTag("foo")).toBeNull();
    expect(parseProtectedReleaseTag("v0.9")).toBeNull();
    expect(parseProtectedReleaseTag("vfoo")).toBeNull();
    expect(parseProtectedReleaseTag("vv1.0.0")).toBeNull();
    expect(parseProtectedReleaseTag("v1.0.0-")).toBeNull();
    expect(() => assertProtectedReleaseTag("release-0.9.0")).toThrow(/v<valid-semver>/);
  });

  it("rejects a valid v* tag whose version does not match the package version", () => {
    expect(() => assertProtectedReleaseTag("v0.9.0-rc.1", "0.9.0-rc.0")).toThrow(
      /!= package version/,
    );
    expect(assertProtectedReleaseTag("v0.9.0-rc.1", "0.9.0-rc.1").distTag).toBe("next");
  });
});

describe("assert-release-tag.mjs CLI", () => {
  it("prints the version for a protected tag and fails lockstep mismatch", () => {
    const script = join(here, "assert-release-tag.mjs");
    const root = mkdtempSync(join(tmpdir(), "rel-tag-"));
    try {
      mkdirSync(join(root, "packages", "schema"), { recursive: true });
      mkdirSync(join(root, "apps", "cli"), { recursive: true });
      writeFileSync(
        join(root, "packages", "schema", "package.json"),
        JSON.stringify({ name: "@actionmanifest/schema", version: "0.9.0-rc.1" }),
      );
      writeFileSync(
        join(root, "apps", "cli", "package.json"),
        JSON.stringify({ name: "@actionmanifest/cli", version: "0.9.0-rc.1" }),
      );
      const ok = spawnSync("node", [script, "--tag", "v0.9.0-rc.1", "--root", root], {
        encoding: "utf8",
      });
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout.trim()).toBe("0.9.0-rc.1");

      const bare = spawnSync("node", [script, "--tag", "0.9.0-rc.1", "--root", root], {
        encoding: "utf8",
      });
      expect(bare.status).not.toBe(0);
      expect(bare.stderr).toMatch(/v<valid-semver>/);

      writeFileSync(
        join(root, "apps", "cli", "package.json"),
        JSON.stringify({ name: "@actionmanifest/cli", version: "0.9.0-rc.0" }),
      );
      const mismatch = spawnSync("node", [script, "--tag", "v0.9.0-rc.1", "--root", root], {
        encoding: "utf8",
      });
      expect(mismatch.status).not.toBe(0);
      expect(mismatch.stderr).toMatch(/!= package version/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
