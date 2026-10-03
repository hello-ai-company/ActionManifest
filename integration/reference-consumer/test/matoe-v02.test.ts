import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyManifest, prepareMatoeV02Manifest } from "@actionmanifest/consumer";
import { validateActionManifest } from "@actionmanifest/core";

const root = resolve(import.meta.dirname, "../../..");
const fixtures = join(root, "packages/consumer/fixtures/matoe-v02");
const read = (name: string) => readFileSync(join(fixtures, name), "utf8");
const cli = join(root, "apps/cli/dist/index.js");

describe("actual built offline server entry / generic consumer boundary", () => {
  it("matches the golden through the real CLI without environment-controlled AI selection", () => {
    const run = spawnSync(process.execPath, [cli, "analyze-matoe", "--stdin-json"], {
      input: read("request.json"), encoding: "utf8",
      env: { ...process.env, ACTIONMAN_PROVIDER: "openai", OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1/must-not-call" },
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    const wire = validateActionManifest(JSON.parse(run.stdout));
    wire.receipt!.extraction.created_at = "2026-10-03T00:00:00.000Z";
    wire.receipt!.verification!.checked_at = "2026-10-03T00:00:00.000Z";
    expect(wire).toEqual(JSON.parse(read("golden.json")));
  });

  it("preserves a failed Action as blocked while unrelated Actions remain ready for generic consumers", () => {
    const input = JSON.parse(read("mixed.json"));
    const request = JSON.parse(read("request.json"));
    const wire = prepareMatoeV02Manifest(input, request.ocrText, request.sourceId);
    const report = classifyManifest(wire);
    expect(report.counts).toEqual({ blocked: 1, ready: 3, review_required: 0 });
    expect(report.actions[0]?.disposition).toBe("blocked");
    expect(report.actions[0]?.reasons.map(reason => reason.code)).toContain("TEMPORAL_UNSUPPORTED");
    expect(wire).toEqual(input);
  });

  it.each(["bad json SYNTHETIC_PRIVATE_MARKER", JSON.stringify({ sourceId: "s", ocrText: "SYNTHETIC_PRIVATE_MARKER", unknown: true })])(
    "emits no success/fallback payload for rejected input, with fixed JSON diagnostics", input => {
      const run = spawnSync(process.execPath, [cli, "analyze-matoe", "--stdin-json"], { input, encoding: "utf8" });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(JSON.parse(run.stderr)).toEqual({ error: { code: "MATOE_REQUEST_INVALID", message: "Invalid analysis request" } });
      expect(run.stderr).not.toContain("SYNTHETIC_PRIVATE_MARKER");
    },
  );
});
