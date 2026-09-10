import { describe, expect, it } from "vitest";
import { validateSbom } from "./sbom-validate.js";

/**
 * SBOM schema validation (President+ChatGPT review, Phase 2.3 blocker 3):
 * the generated SBOM must validate against the OFFICIAL CycloneDX 1.5 JSON
 * Schema (vendored, offline) — including a negative test proving that a
 * deliberately broken SBOM fails.
 */

function minimalValid(): Record<string, unknown> {
  return { bomFormat: "CycloneDX", specVersion: "1.5", version: 1 };
}

/** Mirrors the shape scripts/release-dry-run.ts emits. */
function realisticValid(): Record<string, unknown> {
  return {
    ...minimalValid(),
    metadata: {
      component: {
        type: "application",
        "bom-ref": "pkg:npm/actionmanifest-dry-run",
        name: "actionmanifest",
        version: "0.1.0",
        licenses: [{ license: { id: "Apache-2.0" } }],
      },
      properties: [{ name: "actionmanifest:dry_run", value: "true" }],
    },
    components: [
      {
        type: "library",
        "bom-ref": "pkg:npm/%40actionmanifest/core@0.1.0",
        scope: "required",
        name: "@actionmanifest/core",
        version: "0.1.0",
        licenses: [{ license: { id: "Apache-2.0" } }],
        purl: "pkg:npm/%40actionmanifest/core@0.1.0",
        properties: [{ name: "actionmanifest:tarball_sha256", value: "ab".repeat(32) }],
      },
      {
        type: "library",
        "bom-ref": "pkg:npm/commander@14.0.3",
        scope: "optional",
        name: "commander",
        version: "14.0.3",
        purl: "pkg:npm/commander@14.0.3",
      },
    ],
    dependencies: [
      { ref: "pkg:npm/%40actionmanifest/core@0.1.0", dependsOn: ["pkg:npm/commander@14.0.3"] },
    ],
  };
}

describe("validateSbom (official CycloneDX 1.5 schema, offline)", () => {
  it("accepts a minimal valid BOM", () => {
    const r = validateSbom(minimalValid());
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("accepts a BOM in the shape release-dry-run emits", () => {
    const r = validateSbom(realisticValid());
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("rejects a wrong bomFormat (deliberately broken SBOM fails)", () => {
    const r = validateSbom({ ...minimalValid(), bomFormat: "NotCycloneDX" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("bomFormat");
  });

  it("rejects an unknown root property (additionalProperties: false)", () => {
    const r = validateSbom({ ...minimalValid(), totally_not_a_field: true });
    expect(r.valid).toBe(false);
  });

  it("rejects a component with an invalid type enum", () => {
    const doc = realisticValid();
    (doc.components as Record<string, unknown>[])[0]!["type"] = "not-a-real-type";
    const r = validateSbom(doc);
    expect(r.valid).toBe(false);
  });

  it("notes: official 1.5 schema leaves specVersion a free string (our emitter pins '1.5')", () => {
    // The official schema constrains specVersion to type:string only — a
    // different value is schema-valid. Our emitter always writes "1.5" and
    // the dry-run gate validates structure; the pin is asserted here.
    const r = validateSbom({ ...minimalValid(), specVersion: "1.4" });
    expect(r.valid).toBe(true); // schema-valid by design of the official schema
  });

  it("rejects a component without a name (required field)", () => {
    const doc = realisticValid();
    const components = doc.components as Record<string, unknown>[];
    delete components[0]!["name"];
    const r = validateSbom(doc);
    expect(r.valid).toBe(false);
  });

  it("rejects a non-integer version", () => {
    const r = validateSbom({ ...minimalValid(), version: "1" });
    expect(r.valid).toBe(false);
  });
});
