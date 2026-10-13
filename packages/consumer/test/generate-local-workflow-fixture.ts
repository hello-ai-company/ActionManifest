/** Synthetic content, real offline analysis and actual atomic file-backed execution. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { analyzeMatoeRequest } from "../../../apps/cli/src/matoe-analysis.js";
import { createAssistanceState, registerAssistanceDocument, planLocalPreparation, FileLocalWorkflowHost, LocalWorkflowCoordinator } from "../src/index.js";
import type { WorkflowContext } from "../src/index.js";

const output = resolve(process.argv[2] ?? "docs/assistance/workflow-fixture");
await mkdir(output, { recursive: true });
const request = { sourceId: "22222222-2222-4222-8222-222222222222", ocrText: "遠足は2026年10月14日に実施します。\n参加票を2026年10月15日までに提出してください。\n2026年10月16日までに水筒を準備してください。" };
const manifest = await analyzeMatoeRequest(request);
const now = "2026-10-11T10:00:00.000Z";
const context: WorkflowContext = {
  assistance: registerAssistanceDocument(createAssistanceState("local-preparation-example"), manifest, request.ocrText, request.sourceId, "school-A", [], 0),
  profiles: [{ profile_id: "local-profile-A", scope_key: "school-A", facts: [] }], rules: [],
  permissions: { revision: 1, grants: [{ destination_id: "local-tasks", scope_key: "school-A", operation: "local.task.create" }, { destination_id: "local-schedule", scope_key: "school-A", operation: "local.schedule.create" }] },
  destinations: [{ destination_id: "local-tasks", scope_key: "school-A", locality: "device_local", kind: "task_list", revision: 0 }, { destination_id: "local-schedule", scope_key: "school-A", locality: "device_local", kind: "schedule", revision: 0 }],
};
const plan = planLocalPreparation(context, { intent: "来週の準備をして", profile_id: "local-profile-A", scope_key: "school-A", start_date: "2026-10-12", end_date: "2026-10-19", task_destination_id: "local-tasks", schedule_destination_id: "local-schedule", now });
const temporary = await mkdtemp(join(tmpdir(), "actionmanifest-local-example-"));
try {
  const path = join(temporary, "private-local-state.json");
  const host = await FileLocalWorkflowHost.open(path, context, () => now);
  const coordinator = new LocalWorkflowCoordinator(host); const workflow = await coordinator.create(plan);
  const challenge = await coordinator.requestConfirmation(workflow.workflow_id);
  // Test-only simulated explicit click. Production integrations must wait for the real user.
  await coordinator.confirm(workflow.workflow_id, challenge.token, challenge.plan_digest);
  const result = await coordinator.execute(workflow.workflow_id);
  const restarted = await FileLocalWorkflowHost.open(path, context, () => now);
  const reread = await new LocalWorkflowCoordinator(restarted).verify(workflow.workflow_id);
  const records = JSON.parse(await readFile(path, "utf8")).records;
  if (result.status !== "completed" || reread.status !== "completed" || records.length !== 3) throw new Error("Example did not produce three verified durable records");
  const artifacts = {
    "request.json": request,
    "analyzed-manifest.json": manifest,
    "plan.json": plan,
    "verified-result.json": { workflow_version: result.workflow_version, workflow_id: result.workflow_id, status: result.status, steps: result.steps, reopened_status: reread.status, persisted_records: records },
    "provenance.json": { synthetic_content: true, fake_llm: false, analysis_entrypoint: "analyzeMatoeRequest", provider: manifest.receipt!.extraction.provider, execution_adapter: "FileLocalWorkflowHost", actual_file_commit_and_reopen: true, confirmation: "simulated explicit test click, not a real user authorization", external_writes: false },
  };
  for (const [name, data] of Object.entries(artifacts)) await writeFile(join(output, name), JSON.stringify(data, null, 2) + "\n");
  await writeFile(join(output, "source.txt"), request.ocrText);
  console.log("WORKFLOW-FIXTURE PASS: actual analyze-matoe + 3 local records + reopened verification; no token retained in artifacts");
} finally { await rm(temporary, { recursive: true, force: true }); }
