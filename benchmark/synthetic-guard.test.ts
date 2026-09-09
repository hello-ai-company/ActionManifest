import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const GOLDEN =
  "令和8年10月15日に秋の遠足を実施します。\n参加を希望する方は、10月5日までに参加確認票を提出してください。\n当日は弁当、水筒、タオルを持参してください。\n雨天の場合は10月22日に延期します。\n前回すでに参加確認票を提出した方は、再提出する必要はありません。";

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "dist" || name.name === "node_modules") continue;
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

describe("ENG-20260909-001 gate ① synthetic fixtures only", () => {
  const files = walk(fixturesRoot);

  it("has no email, phone, or API-key-shaped strings in fixture inputs", () => {
    const inputs = files.filter((f) => f.endsWith("input.txt"));
    expect(inputs.length).toBeGreaterThanOrEqual(20);
    for (const file of inputs) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      expect(text, file).not.toMatch(/\b0\d{1,4}-\d{1,4}-\d{3,4}\b/);
      expect(text, file).not.toMatch(/\bsk-[A-Za-z0-9]{10,}\b/);
    }
  });

  it("golden fixture matches the synthetic specification text", () => {
    const golden = readFileSync(
      join(fixturesRoot, "ja/school-golden-excursion/input.txt"),
      "utf8",
    ).trim();
    expect(golden).toBe(GOLDEN);
  });

  it("examples golden notice is the same synthetic text", () => {
    const example = readFileSync(
      join(fixturesRoot, "../../examples/golden-excursion.txt"),
      "utf8",
    ).trim();
    expect(example).toBe(GOLDEN);
  });

  it("packages and CLI source do not import Otayori", () => {
    const roots = [
      join(fixturesRoot, "../../packages"),
      join(fixturesRoot, "../../apps"),
    ];
    for (const root of roots) {
      for (const file of walk(root).filter((f) => f.endsWith(".ts"))) {
        const text = readFileSync(file, "utf8");
        expect(text, file).not.toMatch(/from ["'][^"']*otayori/i);
        expect(text, file).not.toMatch(/@otayori\//i);
      }
    }
  });
});
