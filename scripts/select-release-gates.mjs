#!/usr/bin/env node
/**
 * Resolve exact-SHA CI SUCCESS + FULL Release Check SUCCESS.
 * Prints the full Release Check run id to stdout.
 * Fail closed: FULL RELEASE CHECK NOT FOUND.
 * READ only — no workflow mutation.
 */
import { spawnSync } from "node:child_process";
import {
  FULL_RELEASE_CHECK_NOT_FOUND,
  pickReleaseGates,
} from "./full-release-check.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const sha = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY;
if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
  fail("select-release-gates: exact 40-char git_sha required");
}
if (!repo) {
  fail("select-release-gates: GITHUB_REPOSITORY is required");
}

const api = spawnSync(
  "gh",
  ["api", `repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (api.status !== 0) {
  fail(
    `select-release-gates: cannot list workflow runs for ${sha}: ${(api.stderr || api.stdout || "").trim()}`,
  );
}

let payload;
try {
  payload = JSON.parse(api.stdout);
} catch {
  fail("select-release-gates: workflow-run list was not JSON");
}

const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
const { ci, releaseCheck } = pickReleaseGates(runs, sha);
if (!ci) {
  fail(`CI is not SUCCESS on ${sha}`);
}
if (!releaseCheck) {
  fail(FULL_RELEASE_CHECK_NOT_FOUND);
}
console.log(String(releaseCheck.id));
