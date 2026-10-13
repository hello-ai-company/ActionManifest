/** Synthetic local benchmark, not a mobile/device or accuracy claim. */
import { performance } from "node:perf_hooks";
import { createDocumentEvidenceIndex } from "../packages/core/src/document-query.js";
import type { CanonicalDocument } from "@actionmanifest/schema";

const document: CanonicalDocument = { id: "synthetic-200-pages", pages: Array.from({ length: 200 }, (_, page) => ({
  pageNumber: page + 1,
  text: Array.from({ length: 25 }, (_, row) => `資料${page}項目${row}：申込期限は2026年10月20日。参加費は${1000 + row}円。持ち物は弁当と水筒。条件は原本で確認してください。`).join("\n"),
})) };
const beforeHeap = process.memoryUsage().heapUsed;
const started = performance.now();
const index = createDocumentEvidenceIndex(document);
const buildMs = performance.now() - started;
const heapDeltaBytes = process.memoryUsage().heapUsed - beforeHeap;
const durations: number[] = [];
for (let i = 0; i < 500; i++) {
  const start = performance.now();
  const answer = index.query({ kind: "cost", text: `資料${i % 200}項目${i % 25}`, limit: 8 });
  if (!answer.evidence.length) throw new Error("Synthetic query returned no evidence");
  durations.push(performance.now() - start);
}
durations.sort((a, b) => a - b);
const rebuildDurations: number[] = [];
for (let i = 0; i < 5; i++) {
  const start = performance.now();
  createDocumentEvidenceIndex(document).query({ kind: "cost", text: `資料${i}項目${i}`, limit: 8 });
  rebuildDurations.push(performance.now() - start);
}
console.log(JSON.stringify({ benchmark: "synthetic-canonical-document-evidence-v7", node: process.version,
  pages: 200, passages: index.passageCount, characters: index.characterCount, buildMs,
  repeatedQueries: durations.length, queryP50Ms: durations[Math.floor(durations.length / 2)],
  queryP95Ms: durations[Math.floor(durations.length * .95)], queryMaxMs: durations.at(-1),
  rebuildAndQueryMeanMs: rebuildDurations.reduce((a, b) => a + b, 0) / rebuildDurations.length,
  heapDeltaBytes, caveats: ["Synthetic text only; no PDF/OCR or network cost.", "Heap delta is not peak RSS and GC was not forced.", "Shared cloud machine timing; not iPhone performance."] }, null, 2));
