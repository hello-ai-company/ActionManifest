import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Public API audit: a third-party consumer must be able to do everything
 * through package entry points, and MUST be blocked from deep imports by the
 * package.json `exports` maps.
 */
import * as schema from "@actionmanifest/schema";
import * as core from "@actionmanifest/core";
import * as adapters from "@actionmanifest/adapters";
import * as extractor from "@actionmanifest/extractor";
import * as verifier from "@actionmanifest/verifier";
import * as exporters from "@actionmanifest/exporters";
import * as consumer from "@actionmanifest/consumer";
import * as xberg from "@actionmanifest/adapter-xberg";
import type { AdapterInput, DocumentAdapter } from "@actionmanifest/adapters";
import type {
  XbergAdapterInput,
  XbergBytesInput,
  XbergResultInput,
  XbergUriInput,
} from "@actionmanifest/adapter-xberg";

const require = createRequire(import.meta.url);

describe("public package entry points", () => {
  it("exposes the contract surface a consumer needs", () => {
    // schema: immutable versioned contracts + types
    expect(schema.SCHEMA_VERSION).toBe("0.2.0");
    expect(schema.SUPPORTED_SCHEMA_VERSIONS).toContain("0.1.0");
    expect(schema.actionManifestSchemasByVersion["0.1.0"]).toBeDefined();
    expect(schema.actionManifestSchemasByVersion["0.2.0"]).toBeDefined();
    expect(schema.canonicalDocumentSchema).toBeDefined();

    // core: canonical document model, hashing, validation, errors
    expect(typeof core.validateActionManifest).toBe("function");
    expect(typeof core.validateCanonicalDocument).toBe("function");
    expect(typeof core.assertCanonicalDocument).toBe("function");
    expect(typeof core.checkCanonicalDocument).toBe("function");
    expect(typeof core.locateEvidence).toBe("function");
    expect(typeof core.ensureSourceHash).toBe("function");
    expect(typeof core.manifestFatalReasons).toBe("function");
    expect(typeof core.evaluateActionTrust).toBe("function");
    expect(typeof core.trustDispositionFor).toBe("function");
    expect(core.VERIFIED_TIER_STATUSES).toContain("verified");
    expect(typeof core.DocumentAdapterError).toBe("function");
    expect(typeof core.ExportError).toBe("function");

    // adapters: document boundary
    expect(typeof adapters.PlainTextAdapter).toBe("function");
    expect(typeof adapters.DoclingAdapter).toBe("function");
    expect(typeof adapters.mapDoclingDocument).toBe("function");
    expect(typeof adapters.resolveAdapter).toBe("function");

    // extractor / verifier
    expect(typeof extractor.extractActions).toBe("function");
    expect(typeof extractor.ActionExtractor).toBe("function");
    expect(typeof verifier.verifyManifest).toBe("function");
    expect(typeof verifier.verificationPassed).toBe("function");
    expect(typeof verifier.actionVerificationPassed).toBe("function");

    // exporters / consumer policy
    expect(typeof exporters.exportJson).toBe("function");
    expect(typeof exporters.exportIcs).toBe("function");
    expect(typeof exporters.actionUid).toBe("function");
    expect(typeof exporters.evaluateExportTrust).toBe("function");
    expect(typeof consumer.classifyManifest).toBe("function");
    expect(typeof consumer.readyActions).toBe("function");

    // Xberg adapter: public entry point only (pure mapper + adapter class)
    expect(typeof xberg.XbergAdapter).toBe("function");
    expect(typeof xberg.mapXbergResultToCanonical).toBe("function");
    expect(typeof xberg.XBERG_ADAPTER_VERSION).toBe("string");
  });

  it("exposes the generic DocumentAdapter contract and Xberg-owned input types", () => {
    // Compile-time contract assertions (runtime no-ops):
    // - DocumentAdapter is generic over the adapter's own input type.
    // - Xberg-specific input kinds live in @actionmanifest/adapter-xberg.
    // - The central AdapterInput union does NOT contain xberg kinds.
    const xbergInput: XbergAdapterInput = {
      kind: "xberg-result",
      sourceId: "s",
      payload: {},
    };
    const uri: XbergUriInput = { kind: "xberg-uri", sourceId: "s", uri: "f.pdf" };
    const bytes: XbergBytesInput = {
      kind: "xberg-bytes",
      sourceId: "s",
      bytes: new Uint8Array(),
    };
    const result: XbergResultInput = xbergInput;
    expect(xbergInput.kind).toBe("xberg-result");
    expect(uri.kind).toBe("xberg-uri");
    expect(bytes.kind).toBe("xberg-bytes");
    expect(result.kind).toBe("xberg-result");

    // @ts-expect-error — xberg kinds are NOT part of the central built-in union
    const notCentral: AdapterInput = { kind: "xberg-result", sourceId: "s", payload: {} };
    void notCentral;

    // The generic contract accepts a third-party input type unchanged.
    type ThirdParty = DocumentAdapter<{ kind: "marker-json"; sourceId: string }>;
    const proof: ThirdParty | null = null;
    void proof;
  });

  it("blocks deep/internal imports via package exports maps", () => {
    expect(() => require.resolve("@actionmanifest/core/dist/hash.js")).toThrowError();
    expect(() => require.resolve("@actionmanifest/verifier/src/verify.js")).toThrowError();
    expect(() => require.resolve("@actionmanifest/adapters/dist/docling.js")).toThrowError();
    expect(() => require.resolve("@actionmanifest/adapter-xberg/dist/mapper.js")).toThrowError();
  });

  it("allows the declared schema asset subpaths", () => {
    expect(() =>
      require.resolve("@actionmanifest/schema/schemas/v0.2/action-manifest.schema.json"),
    ).not.toThrowError();
    expect(() =>
      require.resolve("@actionmanifest/schema/schemas/canonical-document.schema.json"),
    ).not.toThrowError();
  });
});
