import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const coreSrc = join(dirname(fileURLToPath(import.meta.url)));

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "dist" || name.name === "node_modules") continue;
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...walkTs(p));
    else if (name.name.endsWith(".ts") && !name.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("ENG-20260909-001 gate ③ Core has no external I/O", () => {
  it("core production sources do not call fetch or third-party write APIs", () => {
    const files = walkTs(coreSrc);
    expect(files.length).toBeGreaterThan(0);
    const bannedCall = /\bfetch\s*\(/;
    const bannedImport =
      /from\s+["'][^"']*(googleapis|todoist|gmail|supabase|firebase|stripe|caldav)[^"']*["']/;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(bannedCall);
      expect(text, file).not.toMatch(bannedImport);
    }
  });
});
