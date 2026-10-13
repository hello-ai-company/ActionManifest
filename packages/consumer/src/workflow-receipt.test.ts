import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canonicalLocalReceipt, type LocalExecutionReceipt } from "./workflow-receipt.js";
import { matoeActionMapping, MATOE_INTEGRATION_CONTRACT } from "./matoe-contract.generated.js";
const fixtures = JSON.parse(readFileSync(new URL("../../../contracts/matoe/receipt-fixtures-v1.json", import.meta.url), "utf8")) as Array<{ receipt: LocalExecutionReceipt; canonical: string; sha256: string }>;
type MutableReceipt = Record<string, unknown> & { steps: Array<Record<string, unknown>> };
describe("versioned Matoe integration contract", () => {
  it("covers all native tools and every schema action kind, without external executors", () => {
    expect(Object.keys(MATOE_INTEGRATION_CONTRACT.native_tools)).toHaveLength(101);
    expect(Object.keys(MATOE_INTEGRATION_CONTRACT.action_kinds)).toHaveLength(13);
    expect(matoeActionMapping("pay")?.portable_operation).toBe("local.task.create");
    expect(matoeActionMapping("pay")?.native_type).toBe("payment");
    for (const unknown of ["x-send", "transfer", "__proto__", "constructor", "local.payment.execute"]) expect(matoeActionMapping(unknown)).toBeUndefined();
    expect(MATOE_INTEGRATION_CONTRACT.external_execution).toBe(false);
  });
  it.each(fixtures)("canonical receipt has stable exact bytes and SHA-256", fixture => {
    expect(canonicalLocalReceipt(fixture.receipt)).toEqual({ json: fixture.canonical, sha256: fixture.sha256 });
  });
  it("rejects authority injection, unknown fields, fake success and foreign operations", () => {
    for (const mutate of [(r: MutableReceipt) => r.authorization = "approved", (r: MutableReceipt) => r.real_world_completion = true,
      (r: MutableReceipt) => r.extra = true, (r: MutableReceipt) => r.steps[0]!.operation = "payment.transfer",
      (r: MutableReceipt) => { r.steps[0]!.status = "verified"; r.steps[0]!.record_id = ""; },
      (r: MutableReceipt) => r.steps[0]!.source_hash = "", (r: MutableReceipt) => r.steps.push(r.steps[0]!)]) {
      const value = structuredClone(fixtures[0]!.receipt); mutate(value as unknown as MutableReceipt); expect(() => canonicalLocalReceipt(value)).toThrow();
    }
  });
});
