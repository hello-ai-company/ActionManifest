import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { classifyFamilyPassage } from "../packages/core/src/family-review.js";
const path = fileURLToPath(new URL("../fixtures/family-review/v1.json", import.meta.url));
const fixture = JSON.parse(readFileSync(path, "utf8")) as { cases: { id: string; quote: string; context: string; domains: string[]; topics: string[]; flags: string[] }[] };
for (const c of fixture.cases) {
  const actual = classifyFamilyPassage(c.quote, c.context);
  for (const key of ["domains", "topics", "flags"] as const) assert.deepEqual(actual[key], c[key], `${c.id}: ${key}`);
}
console.log(`PASS: ${fixture.cases.length} family cue vectors (TypeScript runtime only)`);
