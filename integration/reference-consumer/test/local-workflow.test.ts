/** Built-package consumer: exact CLI analysis + real subprocess interruption + durable recovery. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  createAssistanceState, registerAssistanceDocument, planLocalPreparation,
  FileLocalWorkflowHost, LocalWorkflowCoordinator, type WorkflowContext,
} from "@actionmanifest/consumer";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const now = "2026-10-11T10:00:00.000Z";

it("recovers a real process exit after a committed local record but before its journal acknowledgement", async () => {
  const source = "遠足は2026年10月14日に実施します。\n参加票を2026年10月15日までに提出してください。";
  const id = "33333333-3333-4333-8333-333333333333";
  const stdout = execFileSync(process.execPath, [join(root, "apps/cli/dist/index.js"), "analyze-matoe", "--stdin-json"], { input: JSON.stringify({ sourceId: id, ocrText: source }), encoding: "utf8" });
  const manifest = JSON.parse(stdout);
  const context: WorkflowContext = {
    assistance: registerAssistanceDocument(createAssistanceState("built-local-workflow"), manifest, source, id, "school-A", [], 0),
    profiles: [{ profile_id: "profile-A", scope_key: "school-A", facts: [] }], rules: [],
    permissions: { revision: 1, grants: [{ destination_id: "tasks", scope_key: "school-A", operation: "local.task.create" }, { destination_id: "schedule", scope_key: "school-A", operation: "local.schedule.create" }] },
    destinations: [{ destination_id: "tasks", scope_key: "school-A", kind: "task_list", locality: "device_local", revision: 0 }, { destination_id: "schedule", scope_key: "school-A", kind: "schedule", locality: "device_local", revision: 0 }],
  };
  const dir = mkdtempSync(join(tmpdir(), "actionmanifest-real-crash-"));
  try {
    const path = join(dir, "private-local-state.json");
    const host = await FileLocalWorkflowHost.open(path, context, () => now);
    const coordinator = new LocalWorkflowCoordinator(host);
    const plan = planLocalPreparation(await host.readContext(), { intent: "来週の準備をして", profile_id: "profile-A", scope_key: "school-A", start_date: "2026-10-12", end_date: "2026-10-19", task_destination_id: "tasks", schedule_destination_id: "schedule", now });
    const workflow = await coordinator.create(plan); const challenge = await coordinator.requestConfirmation(workflow.workflow_id);
    await coordinator.confirm(workflow.workflow_id, challenge.token, challenge.plan_digest);
    // Synthetic test approval above. The child exits after the actual atomic file commit.
    const runner = join(dir, "crash.mjs");
    writeFileSync(runner, `import { FileLocalWorkflowHost, LocalWorkflowCoordinator } from ${JSON.stringify(new URL("../../../packages/consumer/dist/index.js", import.meta.url).href)};
const host = await FileLocalWorkflowHost.open(${JSON.stringify(path)}, ${JSON.stringify(context)}, () => ${JSON.stringify(now)});
const original = host.applyLocal.bind(host);
host.applyLocal = async command => { await original(command); process.exit(91); };
await new LocalWorkflowCoordinator(host).execute(${JSON.stringify(workflow.workflow_id)});
`);
    const child = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 10_000 });
    expect(child.status, child.stderr).toBe(91);
    const interrupted = JSON.parse(readFileSync(path, "utf8"));
    expect(interrupted.records).toHaveLength(1); expect(interrupted.workflows[0].status).toBe("running");
    expect(interrupted.workflows[0].steps[0].status).toBe("running");
    const restarted = await FileLocalWorkflowHost.open(path, context, () => now);
    const result = await new LocalWorkflowCoordinator(restarted).execute(workflow.workflow_id);
    expect(result.status).toBe("completed"); expect(result.steps.every(s => s.status === "verified")).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).records).toHaveLength(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
