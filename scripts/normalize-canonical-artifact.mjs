#!/usr/bin/env node
/**
 * Copy a downloaded release-check-<sha> tree to a stable ./release-artifacts
 * layout. Handles `gh run download` nesting
 * (`<dir>/release-check-<sha>/release-artifacts/…`).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

function fail(message) {
  console.error(`normalize-canonical-artifact FAIL: ${message}`);
  process.exit(1);
}

function locateRoot(start) {
  const queue = [start];
  const seen = new Set();
  while (queue.length && seen.size < 32) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    if (
      existsSync(join(current, "SHA256SUMS")) &&
      existsSync(join(current, "release-manifest.json"))
    ) {
      return current;
    }
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "tarballs" || entry.name === "node_modules") continue;
      queue.push(join(current, entry.name));
    }
  }
  fail(`canonical artifact (SHA256SUMS + release-manifest.json) not found under ${start}`);
}

const srcDir = resolve(process.argv[2] || ".");
const dest = resolve(process.argv[3] || "release-artifacts");
const src = locateRoot(srcDir);
if (src !== dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}
console.log(`normalize-canonical-artifact OK — ${src} -> ${dest}`);
