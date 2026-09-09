import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { XbergAdapter } from "./index.js";

/**
 * Live Xberg runtime bridge tests (opt-in; run via `pnpm xberg:integration`).
 * These load the native binding and run real extraction on synthetic local
 * inputs. No network. Not part of the default CI gate — see
 * docs/ADAPTER-XBERG.md for the rationale.
 */

const NOTICE = `保護者向け行事案内

令和8年10月15日に秋の遠足を実施します。
参加を希望する方は、10月5日までに参加確認票を提出してください。
当日は弁当、水筒、タオルを持参してください。
雨天の場合は10月22日に延期します。
`;

describe("XbergAdapter live runtime (opt-in)", () => {
  it("extracts a local text file end to end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xberg-it-"));
    const path = join(dir, "notice.txt");
    writeFileSync(path, NOTICE, "utf8");

    const adapter = new XbergAdapter();
    const doc = await adapter.toCanonical({ kind: "xberg-uri", sourceId: "live-notice", uri: path });
    expect(doc.id).toBe("live-notice");
    expect(doc.text).toContain("秋の遠足");
    expect(doc.text).toContain("10月5日までに参加確認票");
    expect(doc.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("extracts from bytes", async () => {
    const adapter = new XbergAdapter();
    const doc = await adapter.toCanonical({
      kind: "xberg-bytes",
      sourceId: "live-bytes",
      bytes: new TextEncoder().encode(NOTICE),
      filename: "notice.txt",
      mimeType: "text/plain",
    });
    expect(doc.text).toContain("雨天の場合は10月22日");
  });
});
