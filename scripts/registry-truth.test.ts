import { describe, expect, it } from "vitest";
import {
  classifyPackumentError,
  decidePackageState,
  evaluateDistTags,
  evaluatePackageReport,
  packumentUrl,
  probePackumentWithRetries,
  sha256Buffer,
  verifyPackagesOnRegistry,
  type PackumentProbe,
} from "./registry-truth.js";

describe("packumentUrl", () => {
  it("encodes the scoped name so the registry returns the versions map", () => {
    expect(packumentUrl("@actionmanifest/core")).toBe(
      "https://registry.npmjs.org/@actionmanifest%2fcore",
    );
  });
});

describe("classifyPackumentError", () => {
  it("maps 404 / timeout / network distinctly", () => {
    expect(classifyPackumentError("npm ERR! code E404")).toBe("notfound");
    expect(classifyPackumentError("curl: (22) The requested URL returned error: 404")).toBe(
      "notfound",
    );
    expect(classifyPackumentError("ETIMEDOUT")).toBe("timeout");
    expect(classifyPackumentError("command timed out")).toBe("timeout");
    expect(classifyPackumentError("ECONNRESET")).toBe("network");
    expect(classifyPackumentError("unexpected token")).toBe("parse");
  });
});

describe("probePackumentWithRetries", () => {
  it("returns the first ok read and does not keep retrying", () => {
    const calls: number[] = [];
    const result = probePackumentWithRetries((attempt) => {
      calls.push(attempt);
      return { state: "ok", stdout: "{}", attempts: attempt };
    }, 5);
    expect(result.state).toBe("ok");
    expect(calls).toEqual([1]);
  });

  it("retries 404 packument lag and does not treat it as a publish failure", () => {
    let n = 0;
    const result = probePackumentWithRetries(() => {
      n += 1;
      if (n < 3) return { state: "notfound", stdout: "", attempts: n };
      return { state: "ok", stdout: '{"name":"x"}', attempts: n };
    }, 5);
    expect(result.state).toBe("ok");
    expect(n).toBe(3);
  });

  it("retries timeouts; exhausted timeout stays UNKNOWN at decide time", () => {
    const result = probePackumentWithRetries(
      () => ({ state: "timeout", stdout: "", attempts: 1 }),
      3,
    );
    expect(result.state).toBe("timeout");
    expect(result.attempts).toBe(3);
    expect(
      decidePackageState({
        packument: result,
        version: "0.9.0-rc.0",
        versionPresent: false,
        shaMatch: undefined,
        distTagOk: undefined,
      }),
    ).toBe("UNKNOWN");
  });
});

describe("evaluateDistTags", () => {
  it("prerelease requires next=version and documents rc.0 latest without failing", () => {
    const ok = evaluateDistTags("0.9.0-rc.0", { next: "0.9.0-rc.0", latest: "0.9.0-rc.0" });
    expect(ok.ok).toBe(true);
    expect(ok.notes.join(" ")).toMatch(/HISTORICAL/);
    expect(ok.notes.join(" ")).toMatch(/do not auto-repair/);
    const missing = evaluateDistTags("0.9.0-rc.0", { latest: "0.9.0-rc.0" });
    expect(missing.ok).toBe(false);
  });

  it("stable requires latest=version", () => {
    expect(evaluateDistTags("0.9.0", { latest: "0.9.0" }).ok).toBe(true);
    expect(evaluateDistTags("0.9.0", { latest: "0.8.0", next: "0.9.0" }).ok).toBe(false);
  });
});

describe("evaluatePackageReport / verifyPackagesOnRegistry", () => {
  const hash = sha256Buffer(Buffer.from("canonical"));
  const packumentOk = JSON.stringify({
    "dist-tags": { next: "0.9.0-rc.0", latest: "0.9.0-rc.0" },
    versions: { "0.9.0-rc.0": { dist: { tarball: "https://registry.npmjs.org/x/-/x-0.9.0-rc.0.tgz" } } },
  });

  it("PUBLISHED_VERIFIED when version, tags, and sha match", () => {
    const { reports, overall } = verifyPackagesOnRegistry(["@actionmanifest/core"], {
      version: "0.9.0-rc.0",
      canonicalSha256: new Map([["@actionmanifest/core", hash]]),
      readPackument: () => ({ state: "ok", stdout: packumentOk, attempts: 1 }),
      downloadTarball: () => ({ bytes: Buffer.from("canonical") }),
    });
    expect(overall).toBe("PUBLISHED_VERIFIED");
    expect(reports[0]!.state).toBe("PUBLISHED_VERIFIED");
    expect(reports[0]!.notes.join(" ")).toMatch(/HISTORICAL/);
  });

  it("INCONSISTENT on sha mismatch — never suggests republish", () => {
    const { reports } = verifyPackagesOnRegistry(["@actionmanifest/core"], {
      version: "0.9.0-rc.0",
      canonicalSha256: new Map([["@actionmanifest/core", "ff".repeat(32)]]),
      readPackument: () => ({ state: "ok", stdout: packumentOk, attempts: 1 }),
      downloadTarball: () => ({ bytes: Buffer.from("canonical") }),
    });
    expect(reports[0]!.state).toBe("INCONSISTENT");
    expect(JSON.stringify(reports)).not.toMatch(/npm publish|republish/);
  });

  it("PROPAGATING when packument exists but the exact version is not yet listed", () => {
    const { reports } = verifyPackagesOnRegistry(["@actionmanifest/core"], {
      version: "0.9.0-rc.0",
      canonicalSha256: new Map(),
      readPackument: () => ({
        state: "ok",
        stdout: JSON.stringify({ "dist-tags": {}, versions: {} }),
        attempts: 1,
      }),
    });
    expect(reports[0]!.state).toBe("PROPAGATING");
  });

  it("ABSENT after exhausted 404s; UNKNOWN on timeout (not a publish failure)", () => {
    const absentProbe: PackumentProbe = { state: "notfound", stdout: "", attempts: 5 };
    expect(
      evaluatePackageReport(
        "@actionmanifest/core",
        { version: "0.9.0-rc.0", canonicalSha256: new Map() },
        absentProbe,
        undefined,
        undefined,
      ).state,
    ).toBe("ABSENT");
    const timeout = evaluatePackageReport(
      "@actionmanifest/core",
      { version: "0.9.0-rc.0", canonicalSha256: new Map() },
      { state: "timeout", stdout: "", attempts: 5 },
      undefined,
      undefined,
    );
    expect(timeout.state).toBe("UNKNOWN");
    expect(timeout.notes.join(" ")).toMatch(/NOT a publish failure/);
  });
});
