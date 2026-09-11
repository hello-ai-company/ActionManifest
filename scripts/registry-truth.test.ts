import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyPackumentError,
  classifyThreeSourceTruth,
  distTagsUrl,
  exactVersionUrl,
  packumentUrl,
  probePackumentWithRetries,
  probeRegistryWithRetries,
  sha256Buffer,
  verifyPackagesOnRegistry,
  type RegistryRead,
} from "./registry-truth.js";

const here = dirname(fileURLToPath(import.meta.url));
const RC0 = "0.9.0-rc.0";
const NAME = "@actionmanifest/core";
const TARBALL = "https://registry.npmjs.org/@actionmanifest/core/-/core-0.9.0-rc.0.tgz";
const hash = sha256Buffer(Buffer.from("canonical-rc0"));

function read(source: RegistryRead["source"], state: RegistryRead["state"], extra?: Partial<RegistryRead>): RegistryRead {
  return {
    source,
    url: "https://example.test",
    status: state === "ok" ? 200 : state === "notfound" ? 404 : null,
    state,
    stdout: "",
    attempts: extra?.attempts ?? (state === "notfound" ? 5 : 1),
    exhausted404: state === "notfound" && (extra?.exhausted404 ?? true),
    ...extra,
  };
}

const exactOk: RegistryRead = read("exact", "ok", {
  stdout: JSON.stringify({ name: NAME, version: RC0, dist: { tarball: TARBALL } }),
  exhausted404: false,
});
const rootOk: RegistryRead = read("root", "ok", {
  stdout: JSON.stringify({
    "dist-tags": { next: RC0, latest: RC0 },
    versions: { [RC0]: { dist: { tarball: TARBALL } } },
  }),
  exhausted404: false,
});
const tagsOk: RegistryRead = read("dist-tags", "ok", {
  stdout: JSON.stringify({ next: RC0, latest: RC0 }),
  exhausted404: false,
});
const root404 = read("root", "notfound", { exhausted404: true, attempts: 5 });
const exact404 = read("exact", "notfound", { exhausted404: true, attempts: 5 });
const tags404 = read("dist-tags", "notfound", { exhausted404: true, attempts: 5 });

describe("independent registry URLs", () => {
  it("encodes the scoped name as %2F on exact, dist-tags, and root", () => {
    expect(packumentUrl(NAME)).toBe("https://registry.npmjs.org/@actionmanifest%2Fcore");
    expect(exactVersionUrl(NAME, RC0)).toBe(
      "https://registry.npmjs.org/@actionmanifest%2Fcore/0.9.0-rc.0",
    );
    expect(distTagsUrl(NAME)).toBe(
      "https://registry.npmjs.org/-/package/@actionmanifest%2Fcore/dist-tags",
    );
  });

  it("does not use npm view as primary truth", () => {
    const src = readFileSync(join(here, "registry-truth.ts"), "utf8");
    expect(src).not.toMatch(/execFileSync\(\s*["']npm["']/);
    expect(src).not.toMatch(/spawnSync\(\s*["']npm["']/);
    expect(src).toMatch(/NEVER primary truth/);
    expect(src).toMatch(/Exact version/);
    expect(src).toMatch(/Dist-tags/);
    expect(src).toMatch(/Root packument/);
    expect(src).toMatch(/GET-only/);
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

describe("probeRegistryWithRetries", () => {
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
    const result = probeRegistryWithRetries((attempt) => {
      n += 1;
      if (n < 3) {
        return {
          source: "root",
          url: "",
          status: 404,
          state: "notfound",
          stdout: "",
          attempts: attempt,
        };
      }
      return {
        source: "root",
        url: "",
        status: 200,
        state: "ok",
        stdout: '{"name":"x"}',
        attempts: attempt,
      };
    }, 5);
    expect(result.state).toBe("ok");
    expect(n).toBe(3);
    expect(result.exhausted404).toBe(false);
  });

  it("marks exhausted404 after bounded notfound retries", () => {
    const result = probeRegistryWithRetries(
      (attempt) => ({
        source: "exact",
        url: "",
        status: 404,
        state: "notfound",
        stdout: "",
        attempts: attempt,
      }),
      3,
    );
    expect(result.state).toBe("notfound");
    expect(result.attempts).toBe(3);
    expect(result.exhausted404).toBe(true);
  });
});

describe("classifyThreeSourceTruth — rc.0 fixtures", () => {
  it("exact200 + root404 = PROPAGATING (rc.0 packument-lag pattern)", () => {
    const got = classifyThreeSourceTruth({
      exact: exactOk,
      distTags: tags404,
      root: root404,
      version: RC0,
      shaMatch: undefined,
    });
    expect(got.state).toBe("PROPAGATING");
    expect(got.notes.join(" ")).toMatch(/do not republish/);
  });

  it("exact404 + root exhausted404 = ABSENT", () => {
    const got = classifyThreeSourceTruth({
      exact: exact404,
      distTags: tags404,
      root: root404,
      version: RC0,
      shaMatch: undefined,
    });
    expect(got.state).toBe("ABSENT");
  });

  it("exact200 + tag + SHA match = PUBLISHED_VERIFIED (rc.0 next+historical latest)", () => {
    const got = classifyThreeSourceTruth({
      exact: exactOk,
      distTags: tagsOk,
      root: rootOk,
      version: RC0,
      shaMatch: true,
    });
    expect(got.state).toBe("PUBLISHED_VERIFIED");
    expect(got.notes.join(" ")).toMatch(/HISTORICAL/);
    expect(got.notes.join(" ")).toMatch(/do not auto-repair/);
    expect(got.dist_tags.next).toBe(RC0);
    expect(got.dist_tags.latest).toBe(RC0);
  });

  it("exact200 + hash mismatch = INCONSISTENT", () => {
    const got = classifyThreeSourceTruth({
      exact: exactOk,
      distTags: tagsOk,
      root: rootOk,
      version: RC0,
      shaMatch: false,
    });
    expect(got.state).toBe("INCONSISTENT");
  });

  it("exact200 + tag mismatch = INCONSISTENT", () => {
    const got = classifyThreeSourceTruth({
      exact: exactOk,
      distTags: read("dist-tags", "ok", { stdout: JSON.stringify({ latest: RC0 }), exhausted404: false }),
      root: rootOk,
      version: RC0,
      shaMatch: true,
    });
    expect(got.state).toBe("INCONSISTENT");
    expect(got.notes.join(" ")).toMatch(/next/);
  });

  it("timeout or parse = UNKNOWN (not a publish failure)", () => {
    const timeout = classifyThreeSourceTruth({
      exact: read("exact", "timeout"),
      distTags: tagsOk,
      root: rootOk,
      version: RC0,
      shaMatch: true,
    });
    expect(timeout.state).toBe("UNKNOWN");
    expect(timeout.notes.join(" ")).toMatch(/NOT a publish failure/);
    const parse = classifyThreeSourceTruth({
      exact: exactOk,
      distTags: read("dist-tags", "parse"),
      root: rootOk,
      version: RC0,
      shaMatch: true,
    });
    expect(parse.state).toBe("UNKNOWN");
  });
});

describe("verifyPackagesOnRegistry (three independent injectors)", () => {
  function readerFromMap(map: Record<string, { state: RegistryRead["state"]; stdout?: string; status?: number }>) {
    return (url: string) => {
      const hit = Object.entries(map).find(([key]) => url.includes(key));
      if (!hit) {
        return { url, status: null, state: "network" as const, stdout: "" };
      }
      const [, v] = hit;
      return {
        url,
        status: v.status ?? (v.state === "ok" ? 200 : v.state === "notfound" ? 404 : null),
        state: v.state,
        stdout: v.stdout ?? (v.state === "ok" ? "{}" : ""),
      };
    };
  }

  it("PUBLISHED_VERIFIED when exact + tags + root + sha match", () => {
    const { reports, overall } = verifyPackagesOnRegistry([NAME], {
      version: RC0,
      canonicalSha256: new Map([[NAME, hash]]),
      retries: 1,
      readRegistry: readerFromMap({
        "/0.9.0-rc.0": {
          state: "ok",
          stdout: JSON.stringify({ name: NAME, version: RC0, dist: { tarball: TARBALL } }),
        },
        "/dist-tags": { state: "ok", stdout: JSON.stringify({ next: RC0, latest: RC0 }) },
        "@actionmanifest%2Fcore": {
          state: "ok",
          stdout: JSON.stringify({
            "dist-tags": { next: RC0, latest: RC0 },
            versions: { [RC0]: { dist: { tarball: TARBALL } } },
          }),
        },
      }),
      downloadTarball: () => ({ bytes: Buffer.from("canonical-rc0") }),
    });
    expect(overall).toBe("PUBLISHED_VERIFIED");
    expect(reports[0]!.state).toBe("PUBLISHED_VERIFIED");
    expect(reports[0]!.sources?.exact.state).toBe("ok");
    expect(reports[0]!.sources?.root.state).toBe("ok");
  });

  it("PROPAGATING on exact 200 + root 404 even when tags exist", () => {
    const { reports } = verifyPackagesOnRegistry([NAME], {
      version: RC0,
      canonicalSha256: new Map([[NAME, hash]]),
      retries: 1,
      readRegistry: (url) => {
        if (url.endsWith(`/${RC0}`)) {
          return {
            url,
            status: 200,
            state: "ok",
            stdout: JSON.stringify({ name: NAME, version: RC0, dist: { tarball: TARBALL } }),
          };
        }
        if (url.includes("/dist-tags")) {
          return { url, status: 200, state: "ok", stdout: JSON.stringify({ next: RC0 }) };
        }
        return { url, status: 404, state: "notfound", stdout: "" };
      },
    });
    expect(reports[0]!.state).toBe("PROPAGATING");
  });

  it("ABSENT after exhausted exact+root 404s", () => {
    const { reports } = verifyPackagesOnRegistry([NAME], {
      version: RC0,
      canonicalSha256: new Map(),
      retries: 2,
      readRegistry: (url) => ({ url, status: 404, state: "notfound", stdout: "" }),
    });
    expect(reports[0]!.state).toBe("ABSENT");
  });

  it("INCONSISTENT on sha mismatch — never suggests republish", () => {
    const { reports } = verifyPackagesOnRegistry([NAME], {
      version: RC0,
      canonicalSha256: new Map([[NAME, "ff".repeat(32)]]),
      retries: 1,
      readRegistry: (url) => {
        if (url.endsWith(`/${RC0}`)) {
          return {
            url,
            status: 200,
            state: "ok",
            stdout: JSON.stringify({ name: NAME, version: RC0, dist: { tarball: TARBALL } }),
          };
        }
        if (url.includes("/dist-tags")) {
          return { url, status: 200, state: "ok", stdout: JSON.stringify({ next: RC0, latest: RC0 }) };
        }
        return {
          url,
          status: 200,
          state: "ok",
          stdout: JSON.stringify({
            "dist-tags": { next: RC0, latest: RC0 },
            versions: { [RC0]: { dist: { tarball: TARBALL } } },
          }),
        };
      },
      downloadTarball: () => ({ bytes: Buffer.from("canonical-rc0") }),
    });
    expect(reports[0]!.state).toBe("INCONSISTENT");
    expect(JSON.stringify(reports)).not.toMatch(/npm publish|republish/);
  });

  it("UNKNOWN on timeout (not a publish failure)", () => {
    const { reports } = verifyPackagesOnRegistry([NAME], {
      version: RC0,
      canonicalSha256: new Map(),
      retries: 1,
      readRegistry: (url) => ({ url, status: null, state: "timeout", stdout: "" }),
    });
    expect(reports[0]!.state).toBe("UNKNOWN");
    expect(reports[0]!.notes.join(" ")).toMatch(/NOT a publish failure/);
  });
});
