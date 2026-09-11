import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256File, writeSha256Sums } from "./sha256sums.js";
import { verifyCanonicalArtifactLayout } from "./canonical-artifact.js";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import { EXPECTED_PACKAGE_NAMES, validateCanonicalReleaseDir } from "./canonical-validate.mjs";

function fixture(opts?: { badHash?: boolean; nest?: boolean; omitIdentity?: boolean }): string {
  const dl = mkdtempSync(join(tmpdir(), "canonical-art-"));
  const root = opts?.nest ? join(dl, "release-artifacts") : dl;
  mkdirSync(join(root, "tarballs"), { recursive: true });
  const packages = PUBLIC_PACKAGE_NAMES.map((name) => {
    const short = name.split("/")[1]!;
    const file = `actionmanifest-${short}-0.9.0-rc.0.tgz`;
    const abs = join(root, "tarballs", file);
    writeFileSync(abs, `bytes-${short}`);
    return {
      name,
      version: "0.9.0-rc.0",
      tarball: `tarballs/${file}`,
      sha256: opts?.badHash ? "00".repeat(32) : sha256File(abs),
    };
  });
  writeSha256Sums(
    root,
    packages.map((p) => ({ sha256: sha256File(join(root, p.tarball)), file: p.tarball })),
  );
  if (opts?.badHash) {
    writeFileSync(
      join(root, "SHA256SUMS"),
      packages.map((p) => `${p.sha256}  tarballs/${p.tarball.replace(/^tarballs\//, "")}`).join("\n") +
        "\n",
    );
  }
  writeFileSync(
    join(root, "release-manifest.json"),
    JSON.stringify(
      {
        identity: opts?.omitIdentity
          ? undefined
          : {
              version: "0.9.0-rc.0",
              git_sha: "c0030b71e7497eb7e53b9348fa7101733f025b85",
              git_tree: "918112608e35ba5d59cc47302324f71263280848",
              package_manager: "pnpm@11.23.0",
              node_major: 22,
              pnpm_version: "11.23.0",
              platform: "linux",
              packages,
              publish_order: packages.map((p) => p.name),
            },
        publish_order: packages.map((p) => p.name),
        packages,
        git: { head: "c0030b71e7497eb7e53b9348fa7101733f025b85" },
      },
      null,
      2,
    ) + "\n",
  );
  return dl;
}

describe("verifyCanonicalArtifactLayout", () => {
  it("accepts a 10-tarball artifact with matching SHA256SUMS + manifest order", () => {
    const dl = fixture({ nest: true });
    try {
      const { artifact, issues } = verifyCanonicalArtifactLayout(
        dl,
        "c0030b71e7497eb7e53b9348fa7101733f025b85",
      );
      expect(issues).toEqual([]);
      expect(artifact.tarballs).toHaveLength(10);
      expect(artifact.manifest.publish_order).toHaveLength(10);
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });

  it("normalize-canonical-artifact copies a flattened download into release-artifacts/", () => {
    const dl = fixture();
    const dest = mkdtempSync(join(tmpdir(), "norm-out-"));
    try {
      const script = join(dirname(fileURLToPath(import.meta.url)), "normalize-canonical-artifact.mjs");
      const r = spawnSync("node", [script, dl, dest], { encoding: "utf8" });
      expect(r.status, r.stderr || r.stdout).toBe(0);
      expect(existsSync(join(dest, "SHA256SUMS"))).toBe(true);
      expect(existsSync(join(dest, "release-manifest.json"))).toBe(true);
    } finally {
      rmSync(dl, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it("flags hash mismatch and missing tarballs", () => {
    const dl = fixture({ badHash: true });
    try {
      const { issues } = verifyCanonicalArtifactLayout(dl);
      expect(issues.some((i) => i.code === "sha256sums")).toBe(true);
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });

  it("FAILS when expectedHead is supplied but identity is missing", () => {
    const dl = fixture({ omitIdentity: true });
    try {
      const { issues } = verifyCanonicalArtifactLayout(
        dl,
        "c0030b71e7497eb7e53b9348fa7101733f025b85",
      );
      expect(issues.some((i) => i.code === "identity-missing")).toBe(true);
      expect(issues.map((i) => i.message).join("\n")).toMatch(/identity is missing/);
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });

  it("fails when identity.git_sha or version does not match the requested release", () => {
    const dl = fixture();
    try {
      const sha = verifyCanonicalArtifactLayout(dl, "ffffffffffffffffffffffffffffffffffffffff");
      expect(sha.issues.some((i) => i.code === "git-sha")).toBe(true);
      const ver = verifyCanonicalArtifactLayout(
        dl,
        "c0030b71e7497eb7e53b9348fa7101733f025b85",
        "0.9.0-rc.1",
      );
      expect(ver.issues.length).toBeGreaterThan(0);
      expect(ver.issues.map((i) => i.message).join("\n")).toMatch(/version/);
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });

  it("keeps EXPECTED_PACKAGE_NAMES lockstepped with PUBLIC_PACKAGE_NAMES", () => {
    expect([...EXPECTED_PACKAGE_NAMES]).toEqual([...PUBLIC_PACKAGE_NAMES]);
  });
});

function manifestRoot(dl: string): string {
  return existsSync(join(dl, "release-manifest.json")) ? dl : join(dl, "release-artifacts");
}

function mutateManifest(dl: string, fn: (manifest: Record<string, unknown>) => void): void {
  const path = join(manifestRoot(dl), "release-manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  fn(manifest);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

describe("validateCanonicalReleaseDir fail-closed identity", () => {
  const head = "c0030b71e7497eb7e53b9348fa7101733f025b85";

  it("PASS on a valid artifact", () => {
    const dl = fixture();
    try {
      expect(
        validateCanonicalReleaseDir({
          dir: manifestRoot(dl),
          expectedHead: head,
          expectedVersion: "0.9.0-rc.0",
          requireIdentity: true,
        }).ok,
      ).toBe(true);
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });

  it("FAIL when a package entry.version is missing", () => {
    const dl = fixture();
    try {
      mutateManifest(dl, (m) => {
        const pkgs = m.packages as { name: string; version?: string }[];
        delete pkgs[0]!.version;
      });
      expect(() =>
        validateCanonicalReleaseDir({ dir: manifestRoot(dl), expectedHead: head }),
      ).toThrow(/version is required/);
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });

  it("FAIL when identity.packages is missing", () => {
    const dl = fixture();
    try {
      mutateManifest(dl, (m) => {
        const identity = m.identity as Record<string, unknown>;
        delete identity.packages;
      });
      expect(() =>
        validateCanonicalReleaseDir({ dir: manifestRoot(dl), expectedHead: head }),
      ).toThrow(/identity\.packages is required/);
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });

  it("FAIL when an identity package sha256 mismatches top-level packages", () => {
    const dl = fixture();
    try {
      mutateManifest(dl, (m) => {
        const identity = m.identity as { packages: { sha256: string; name: string }[] };
        identity.packages[0]!.sha256 = "ff".repeat(32);
      });
      expect(() =>
        validateCanonicalReleaseDir({ dir: manifestRoot(dl), expectedHead: head }),
      ).toThrow(/sha256 mismatch/);
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });

  it("FAIL when identity.publish_order mismatches publish_order", () => {
    const dl = fixture();
    try {
      mutateManifest(dl, (m) => {
        const identity = m.identity as { publish_order: string[] };
        identity.publish_order = [...identity.publish_order].reverse();
      });
      expect(() =>
        validateCanonicalReleaseDir({ dir: manifestRoot(dl), expectedHead: head }),
      ).toThrow(/identity\.publish_order mismatch/);
    } finally {
      rmSync(dl, { recursive: true, force: true });
    }
  });
});
