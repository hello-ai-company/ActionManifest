/**
 * Select a successful FULL Release Check run. PR checks are never enough.
 * Network: none. Callers pass already-fetched run objects.
 */

/**
 * @typedef {{
 *   id: number,
 *   name?: string,
 *   head_sha?: string,
 *   conclusion?: string | null,
 *   event?: string,
 *   created_at?: string,
 *   updated_at?: string,
 *   status?: string,
 * }} WorkflowRun
 */

const FULL_EVENTS = new Set(["push", "workflow_dispatch"]);

export const FULL_RELEASE_CHECK_NOT_FOUND = "FULL RELEASE CHECK NOT FOUND";

/**
 * @param {WorkflowRun} run
 * @param {string} expectedSha
 */
export function isFullSuccessfulReleaseCheck(run, expectedSha) {
  if (!run || typeof run !== "object") return false;
  if (run.name !== "Release Check") return false;
  if (run.head_sha !== expectedSha) return false;
  if (run.conclusion !== "success") return false;
  if (run.event === "pull_request") return false;
  if (!FULL_EVENTS.has(run.event ?? "")) return false;
  return true;
}

/**
 * @param {WorkflowRun[]} runs
 * @param {string} name
 * @param {string} expectedSha
 * @returns {WorkflowRun | null}
 */
export function selectSuccessfulWorkflowRun(runs, name, expectedSha) {
  if (!Array.isArray(runs) || typeof name !== "string" || !name) return null;
  if (typeof expectedSha !== "string" || !expectedSha) return null;
  const matches = runs.filter(
    (run) =>
      run &&
      run.name === name &&
      run.head_sha === expectedSha &&
      run.conclusion === "success",
  );
  return newestRun(matches);
}

/**
 * @param {WorkflowRun[]} runs
 * @param {string} expectedSha
 * @returns {WorkflowRun | null}
 */
export function selectFullReleaseCheckRun(runs, expectedSha) {
  if (!Array.isArray(runs) || typeof expectedSha !== "string" || !expectedSha) {
    return null;
  }
  return newestRun(runs.filter((run) => isFullSuccessfulReleaseCheck(run, expectedSha)));
}

/**
 * @param {WorkflowRun[]} runs
 * @param {string} expectedSha
 */
export function pickReleaseGates(runs, expectedSha) {
  return {
    ci: selectSuccessfulWorkflowRun(runs, "CI", expectedSha),
    releaseCheck: selectFullReleaseCheckRun(runs, expectedSha),
  };
}

/**
 * @param {WorkflowRun[]} runs
 * @returns {WorkflowRun | null}
 */
function newestRun(runs) {
  const matches = [...runs];
  matches.sort((a, b) => {
    const ta = Date.parse(String(b.updated_at ?? b.created_at ?? 0));
    const tb = Date.parse(String(a.updated_at ?? a.created_at ?? 0));
    return ta - tb;
  });
  return matches[0] ?? null;
}
