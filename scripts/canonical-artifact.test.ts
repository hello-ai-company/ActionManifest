import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256File, writeSha256Sums } from "./sha256sums.js";
import { verifyCanonicalArtifactLayout } from "./canonical-artifact.js";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";

function fixture(opts?: { badHash?: boolean; nest?: boolean }): string {
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
        identity: {
          version: "0.9.0-rc.0",
          git_sha: "c0030b71e7497eb7e53b9348fa7101733f025b85",
          git_tree: "918112608e35ba5d59cc47302324f71263280848",
          package_manager: "pnpm@11.23.0",
          node_version: "v22.18.0",
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
});
