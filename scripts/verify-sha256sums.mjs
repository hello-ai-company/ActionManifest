#!/usr/bin/env node
/**
 * Cwd-independent SHA256SUMS check (Node 20+; no TypeScript).
 * Resolves bare filenames into tarballs/ and accepts tarballs/ prefixes.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function fail(message) {
  console.error(`verify-sha256sums FAIL: ${message}`);
  process.exit(1);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function resolveSumPath(root, recorded) {
  const direct = join(root, recorded);
  if (existsSync(direct)) return direct;
  const base = basename(recorded);
  const under = join(root, "tarballs", base);
  if (existsSync(under)) return under;
  const sibling = join(root, base);
  if (existsSync(sibling)) return sibling;
  fail(`path ${recorded} not found under ${root} (tried tarballs/${base})`);
}

function locateRoot(start) {
  const queue = [start];
  const seen = new Set();
  while (queue.length && seen.size < 32) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    if (existsSync(join(current, "SHA256SUMS"))) return current;
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
  fail(`SHA256SUMS not found under ${start}`);
}

const root = locateRoot(resolve(process.argv[2] || "release-artifacts"));
const text = readFileSync(join(root, "SHA256SUMS"), "utf8");
let n = 0;
for (const raw of text.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const m = /^([a-f0-9]{64}) [ *](.+)$/.exec(line);
  if (!m) fail(`unreadable line: ${JSON.stringify(raw)}`);
  const resolved = resolveSumPath(root, m[2].trim());
  const actual = sha256File(resolved);
  if (actual !== m[1]) fail(`${m[2]}: expected ${m[1]}, got ${actual}`);
  n += 1;
}
if (n !== 10) fail(`expected 10 hashed tarballs, got ${n}`);
console.log(`verify-sha256sums OK — ${n} files (${root})`);
