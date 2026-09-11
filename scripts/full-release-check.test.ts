import { describe, expect, it } from "vitest";
import {
  FULL_RELEASE_CHECK_NOT_FOUND,
  isFullSuccessfulReleaseCheck,
  pickReleaseGates,
  selectFullReleaseCheckRun,
} from "./full-release-check.mjs";

const SHA = "c0030b71e7497eb7e53b9348fa7101733f025b85";
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function run(partial: Record<string, unknown>) {
  return {
    id: 1,
    name: "Release Check",
    head_sha: SHA,
    conclusion: "success",
    event: "push",
    updated_at: "2026-09-11T00:00:00Z",
    ...partial,
  };
}

describe("selectFullReleaseCheckRun", () => {
  it("accepts push and workflow_dispatch SUCCESS on the exact SHA", () => {
    expect(selectFullReleaseCheckRun([run({ event: "push", id: 11 })], SHA)?.id).toBe(11);
    expect(
      selectFullReleaseCheckRun([run({ event: "workflow_dispatch", id: 12 })], SHA)?.id,
    ).toBe(12);
  });

  it("rejects pull_request even when conclusion is success", () => {
    const pr = run({ event: "pull_request", id: 99, conclusion: "success" });
    expect(isFullSuccessfulReleaseCheck(pr, SHA)).toBe(false);
    expect(selectFullReleaseCheckRun([pr], SHA)).toBeNull();
  });

  it("rejects wrong name, wrong SHA, or non-success conclusion", () => {
    expect(selectFullReleaseCheckRun([run({ name: "CI" })], SHA)).toBeNull();
    expect(selectFullReleaseCheckRun([run({ head_sha: OTHER })], SHA)).toBeNull();
    expect(selectFullReleaseCheckRun([run({ conclusion: "failure" })], SHA)).toBeNull();
    expect(selectFullReleaseCheckRun([run({ conclusion: "cancelled" })], SHA)).toBeNull();
  });

  it("does not take array[0] when that run is a PR check; picks the full run", () => {
    const runs = [
      run({
        id: 1,
        event: "pull_request",
        conclusion: "success",
        updated_at: "2026-09-11T12:00:00Z",
      }),
      run({
        id: 2,
        event: "push",
        conclusion: "success",
        updated_at: "2026-09-11T11:00:00Z",
      }),
    ];
    expect(selectFullReleaseCheckRun(runs, SHA)?.id).toBe(2);
  });

  it("returns null (FULL RELEASE CHECK NOT FOUND) when only PR success exists", () => {
    expect(
      selectFullReleaseCheckRun([run({ event: "pull_request", conclusion: "success" })], SHA),
    ).toBeNull();
    expect(FULL_RELEASE_CHECK_NOT_FOUND).toBe("FULL RELEASE CHECK NOT FOUND");
  });

  it("picks the newest full SUCCESS when several exist", () => {
    const runs = [
      run({ id: 10, event: "push", updated_at: "2026-09-10T00:00:00Z" }),
      run({ id: 20, event: "workflow_dispatch", updated_at: "2026-09-11T00:00:00Z" }),
    ];
    expect(selectFullReleaseCheckRun(runs, SHA)?.id).toBe(20);
  });
});

describe("pickReleaseGates", () => {
  it("requires CI success and a FULL Release Check independently", () => {
    const none = pickReleaseGates(
      [run({ name: "Release Check", event: "pull_request" }), run({ name: "CI", conclusion: "failure" })],
      SHA,
    );
    expect(none.ci).toBeNull();
    expect(none.releaseCheck).toBeNull();

    const ok = pickReleaseGates(
      [
        run({ name: "CI", id: 7, event: "pull_request", conclusion: "success" }),
        run({ name: "Release Check", id: 8, event: "push", conclusion: "success" }),
      ],
      SHA,
    );
    expect(ok.ci?.id).toBe(7);
    expect(ok.releaseCheck?.id).toBe(8);
  });
});
