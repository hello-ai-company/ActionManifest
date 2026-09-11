import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatSha256Sums,
  locateArtifactRoot,
  parseSha256Sums,
  resolveSumPath,
  sha256File,
  verifySha256Sums,
  writeSha256Sums,
} from "./sha256sums.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "sha256sums-"));
}

describe("parseSha256Sums", () => {
  it("parses GNU two-space and asterisk forms", () => {
    const text = [
      "aa".repeat(32) + "  tarballs/a.tgz",
      "bb".repeat(32) + " *bare.tgz",
      "",
      "# comment",
    ].join("\n");
    expect(parseSha256Sums(text)).toEqual([
      { sha256: "aa".repeat(32), recorded: "tarballs/a.tgz" },
      { sha256: "bb".repeat(32), recorded: "bare.tgz" },
    ]);
  });

  it("rejects unreadable lines", () => {
    expect(() => parseSha256Sums("not-a-hash  file.tgz\n")).toThrow(/unreadable/);
  });
});

describe("SHA256SUMS cwd bug (bare filenames + tarballs/ dir)", () => {
  it("resolves bare names into tarballs/ without changing cwd", () => {
    const root = tempDir();
    try {
      mkdirSync(join(root, "tarballs"));
      const tgz = join(root, "tarballs", "actionmanifest-cli-0.9.0-rc.0.tgz");
      writeFileSync(tgz, "canonical-bytes");
      expect(resolveSumPath(root, "actionmanifest-cli-0.9.0-rc.0.tgz")).toBe(tgz);
      expect(resolveSumPath(root, "tarballs/actionmanifest-cli-0.9.0-rc.0.tgz")).toBe(tgz);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies a SHA256SUMS that lists bare names while files live in tarballs/", () => {
    const root = tempDir();
    try {
      mkdirSync(join(root, "tarballs"));
      const tgz = join(root, "tarballs", "pkg.tgz");
      writeFileSync(tgz, "hello");
      const hash = sha256File(tgz);
      writeFileSync(join(root, "SHA256SUMS"), `${hash}  pkg.tgz\n`, "utf8");
      const result = verifySha256Sums(root);
      expect(result.ok).toBe(true);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.resolved).toBe(tgz);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies a SHA256SUMS that lists tarballs/ prefixes (sha256sum --check layout)", () => {
    const root = tempDir();
    try {
      mkdirSync(join(root, "tarballs"));
      const tgz = join(root, "tarballs", "pkg.tgz");
      writeFileSync(tgz, "hello");
      writeSha256Sums(root, [{ sha256: sha256File(tgz), file: tgz }]);
      const sums = parseSha256Sums(
        // read back via verify
        `${sha256File(tgz)}  tarballs/pkg.tgz\n`,
      );
      expect(sums[0]!.recorded).toBe("tarballs/pkg.tgz");
      expect(verifySha256Sums(root).ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the recorded hash does not match the file bytes", () => {
    const root = tempDir();
    try {
      mkdirSync(join(root, "tarballs"));
      writeFileSync(join(root, "tarballs", "pkg.tgz"), "hello");
      writeFileSync(join(root, "SHA256SUMS"), `${"ab".repeat(32)}  pkg.tgz\n`, "utf8");
      const result = verifySha256Sums(root);
      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/expected/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("formatSha256Sums always writes tarballs/ prefixes from bare or nested inputs", () => {
    const text = formatSha256Sums([
      { sha256: "aa".repeat(32), file: "actionmanifest-core-0.9.0-rc.0.tgz" },
      { sha256: "bb".repeat(32), file: "/tmp/out/tarballs/actionmanifest-cli-0.9.0-rc.0.tgz" },
    ]);
    expect(text).toBe(
      `${"aa".repeat(32)}  tarballs/actionmanifest-core-0.9.0-rc.0.tgz\n` +
        `${"bb".repeat(32)}  tarballs/actionmanifest-cli-0.9.0-rc.0.tgz\n`,
    );
  });
});

describe("locateArtifactRoot", () => {
  it("finds a nested release-artifacts/ download layout", () => {
    const dl = tempDir();
    try {
      mkdirSync(join(dl, "release-artifacts", "tarballs"), { recursive: true });
      writeFileSync(join(dl, "release-artifacts", "SHA256SUMS"), "x\n");
      expect(locateArtifactRoot(dl)).toBe(join(dl, "release-artifacts"));
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });

  it("finds gh run download nesting (release-check-<sha>/release-artifacts)", () => {
    const dl = tempDir();
    try {
      const nested = join(dl, "release-check-c0030b71e7497eb7e53b9348fa7101733f025b85", "release-artifacts");
      mkdirSync(join(nested, "tarballs"), { recursive: true });
      writeFileSync(join(nested, "SHA256SUMS"), "x\n");
      writeFileSync(join(nested, "release-manifest.json"), "{}\n");
      expect(locateArtifactRoot(dl)).toBe(nested);
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });
});
