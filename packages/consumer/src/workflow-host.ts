import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { AssistanceError, fingerprint, requireValue } from "./assistance-common.js";
import { assertLocalPlanCurrent, validateWorkflowContext } from "./workflow-plan.js";
import { localIdempotencyKey, LocalCommitError, restoreLocalWorkflow, verifyLocalRecord } from "./workflow-runtime.js";
import type { LocalOperationCommand, LocalRecord, LocalWorkflow, LocalWorkflowHost, WorkflowContext } from "./workflow-types.js";

interface HostSnapshot { version: "0.1.0"; context: WorkflowContext; workflows: LocalWorkflow[]; records: LocalRecord[] }
/** Reference local database for tests/embedders. exportSnapshot is serializable, not durable.
 * Use FileLocalWorkflowHost or a transactional application database for durable operation.
 */
export class MemoryLocalWorkflowHost implements LocalWorkflowHost {
  private context: WorkflowContext;
  private workflows = new Map<string, LocalWorkflow>();
  private records = new Map<string, LocalRecord>();
  constructor(context: WorkflowContext, private readonly clock: () => string = () => new Date().toISOString()) {
    validateWorkflowContext(context, clock()); this.context = structuredClone(context);
  }
  now(): string { return this.clock(); }
  async readContext(): Promise<WorkflowContext> { return structuredClone(this.context); }
  async load(id: string): Promise<LocalWorkflow | undefined> { const value = this.workflows.get(id); return value && structuredClone(value); }
  async compareAndSwap(id: string, expected: number | null, next: LocalWorkflow): Promise<boolean> {
    const current = this.workflows.get(id);
    if (expected === null ? current !== undefined : current?.revision !== expected) return false;
    const checked = restoreLocalWorkflow(JSON.stringify(next));
    requireValue(id === checked.workflow_id && checked.revision === (expected === null ? 0 : expected + 1), "INVALID_REVISION", "CAS revision must advance once");
    requireValue(current || this.workflows.size < 256, "INPUT_LIMIT", "Local workflow capacity reached");
    if (current) requireValue(current.plan.digest === checked.plan.digest, "PLAN_IMMUTABLE", "Replanning requires a new workflow identity");
    const serialized = this.snapshot([...this.workflows.values()].filter(w => w.workflow_id !== id).concat(checked));
    requireValue(Buffer.byteLength(serialized) <= 16 * 1024 * 1024, "INPUT_LIMIT", "Local database capacity reached");
    this.workflows.set(id, checked); return true;
  }
  async applyLocal(command: LocalOperationCommand): Promise<LocalRecord> {
    // There is intentionally no await between validation and commit: this is one in-memory transaction.
    const workflow = this.workflows.get(command.workflow_id);
    try {
      requireValue(workflow, "WORKFLOW_NOT_FOUND", "Workflow missing at commit");
      const step = workflow.plan.steps.find(s => s.step_id === command.step.step_id);
      requireValue(step && fingerprint(step) === fingerprint(command.step) && command.plan_digest === workflow.plan.digest && command.context_fingerprint === workflow.plan.context_fingerprint && command.permission_fingerprint === workflow.plan.permission_fingerprint && command.idempotency_key === localIdempotencyKey(workflow.workflow_id, step), "COMMAND_MISMATCH", "Commit must match immutable journal step");
      const existing = this.records.get(command.idempotency_key);
      if (existing) { requireValue(verifyLocalRecord(existing, workflow, step), "IDEMPOTENCY_CONFLICT", "Existing record differs"); return structuredClone(existing); }
      const auth = workflow.authorization;
      requireValue(workflow.status === "running" && !workflow.cancelled_at && workflow.steps.find(s => s.step_id === step.step_id)?.status === "running", "WORKFLOW_CANCELLED", "Commit is no longer active");
      requireValue(auth?.authorization_id === command.authorization_id && auth.consumed_at && auth.step_ids.includes(step.step_id) && Date.parse(this.now()) >= Date.parse(auth.consumed_at) && Date.parse(this.now()) < Date.parse(auth.expires_at), "CONFIRMATION_EXPIRED", "Commit lacks live exact confirmation");
      assertLocalPlanCurrent(workflow.plan, this.context, this.now());
      const destination = this.context.destinations.find(d => d.destination_id === step.destination_id)!;
      requireValue(destination.revision === command.expected_destination_revision, "STALE_DESTINATION", "Destination changed before commit");
      const record: LocalRecord = { record_id: randomUUID(), idempotency_key: command.idempotency_key, workflow_id: workflow.workflow_id, step_id: step.step_id, binding: step.binding, operation: step.operation, destination_id: step.destination_id, scope_key: step.scope_key, args: structuredClone(step.args), action_ref: structuredClone(step.action_ref), destination_revision: destination.revision + 1 };
      requireValue(this.records.size < 16384 && Buffer.byteLength(this.snapshot(undefined, [...this.records.values(), record])) + 32 <= 16 * 1024 * 1024, "INPUT_LIMIT", "Local record capacity reached");
      destination.revision++; this.records.set(command.idempotency_key, record);
      return structuredClone(record);
    } catch (error) {
      if (error instanceof LocalCommitError) throw error;
      throw new LocalCommitError(error instanceof AssistanceError ? error.code : "COMMIT_DENIED", false, "Atomic local commit rejected without a write");
    }
  }
  async readLocal(destinationId: string, key: string): Promise<LocalRecord | undefined> {
    const record = this.records.get(key); return record?.destination_id === destinationId ? structuredClone(record) : undefined;
  }
  /** Host-only change hook: tests/application integrations must advance real revisions. */
  replaceContext(context: WorkflowContext): void {
    validateWorkflowContext(context, this.now());
    requireValue(context.permissions.revision >= this.context.permissions.revision
      && (fingerprint(context.permissions) === fingerprint(this.context.permissions) || context.permissions.revision > this.context.permissions.revision), "STALE_PERMISSION", "Permission changes must advance their revision");
    for (const previous of this.context.destinations) {
      const next = context.destinations.find(d => d.destination_id === previous.destination_id);
      if (next) requireValue(next.revision >= previous.revision && next.scope_key === previous.scope_key && next.kind === previous.kind, "STALE_DESTINATION", "Destination identities cannot change scope/kind or roll back revisions");
    }
    for (const record of this.records.values()) requireValue((context.destinations.find(d => d.destination_id === record.destination_id)?.revision ?? -1) >= record.destination_revision, "STALE_DESTINATION", "Cannot roll back destination revisions with persisted records");
    const previous = this.context; this.context = structuredClone(context);
    try { this.exportSnapshot(); } catch (error) { this.context = previous; throw error; }
  }
  private snapshot(workflows = [...this.workflows.values()], records = [...this.records.values()]): string { return JSON.stringify({ version: "0.1.0", context: this.context, workflows, records } satisfies HostSnapshot); }
  exportSnapshot(): string { const serialized = this.snapshot(); requireValue(Buffer.byteLength(serialized) <= 16 * 1024 * 1024, "INPUT_LIMIT", "Local database snapshot exceeds limit"); return serialized; }
  static restore(serialized: string, clock?: () => string): MemoryLocalWorkflowHost {
    requireValue(Buffer.byteLength(serialized) <= 16 * 1024 * 1024, "INPUT_LIMIT", "Local database snapshot exceeds limit");
    const snapshot = JSON.parse(serialized) as HostSnapshot;
    requireValue(snapshot.version === "0.1.0" && Array.isArray(snapshot.workflows) && snapshot.workflows.length <= 256 && Array.isArray(snapshot.records) && snapshot.records.length <= 16384, "INVALID_DATABASE", "Invalid local database snapshot");
    const host = new MemoryLocalWorkflowHost(snapshot.context, clock);
    for (const raw of snapshot.workflows) { const workflow = restoreLocalWorkflow(JSON.stringify(raw)); requireValue(!host.workflows.has(workflow.workflow_id), "INVALID_DATABASE", "Duplicate workflow"); host.workflows.set(workflow.workflow_id, workflow); }
    for (const record of snapshot.records) {
      const workflow = host.workflows.get(record.workflow_id); const step = workflow?.plan.steps.find(s => s.step_id === record.step_id);
      requireValue(workflow && step && verifyLocalRecord(record, workflow, step) && !host.records.has(record.idempotency_key), "INVALID_DATABASE", "Invalid local record");
      requireValue((host.context.destinations.find(d => d.destination_id === record.destination_id)?.revision ?? -1) >= record.destination_revision, "INVALID_DATABASE", "Record revision exceeds destination");
      host.records.set(record.idempotency_key, structuredClone(record));
    }
    return host;
  }
}
/** Small reference durable LOCAL host. All journal, destination rows and idempotency keys
 * share a single fsynced atomic snapshot transaction guarded by an exclusive lock directory.
 * Crash before rename = no commit; after rename = recover by re-read, never duplicate.
 * A crash may leave .lock behind: fail closed, never auto-steal a possibly live writer's lock.
 * Production hosts should use their native transactional database and private app directory.
 */
export class FileLocalWorkflowHost implements LocalWorkflowHost {
  private constructor(private readonly path: string, private readonly clock: () => string) {}
  static async open(path: string, initialContext: WorkflowContext, clock: () => string = () => new Date().toISOString()): Promise<FileLocalWorkflowHost> {
    const host = new FileLocalWorkflowHost(path, clock);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await host.transaction(async () => undefined, initialContext);
    return host;
  }
  now(): string { return this.clock(); }
  private async readHost(): Promise<MemoryLocalWorkflowHost> {
    const handle = await open(this.path, "r");
    try {
      const size = (await handle.stat()).size;
      requireValue(size <= 16 * 1024 * 1024, "INPUT_LIMIT", "Local database file exceeds limit");
      const buffer = Buffer.alloc(size + 1);
      let offset = 0;
      while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
      requireValue(offset === size, "INVALID_DATABASE", "Local database size changed while reading");
      return MemoryLocalWorkflowHost.restore(buffer.subarray(0, size).toString("utf8"), this.clock);
    } finally { await handle.close(); }
  }
  private async transaction<T>(run: (host: MemoryLocalWorkflowHost) => Promise<T>, initialContext?: WorkflowContext): Promise<T> {
    const lock = `${this.path}.lock`;
    try { await mkdir(lock); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AssistanceError("LOCAL_STORE_BUSY", "Local store is locked; retry after writer finishes. An orphan lock needs host recovery.");
      throw error;
    }
    let temp: string | undefined;
    try {
      let host: MemoryLocalWorkflowHost;
      try { host = await this.readHost(); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !initialContext) throw error;
        host = new MemoryLocalWorkflowHost(initialContext, this.clock);
      }
      const result = await run(host);
      temp = `${this.path}.${randomUUID()}.tmp`;
      const handle = await open(temp, "wx", 0o600);
      try { const snapshot = host.exportSnapshot(); MemoryLocalWorkflowHost.restore(snapshot, this.clock); await handle.writeFile(snapshot); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, this.path); temp = undefined;
      const directory = await open(dirname(this.path), "r"); try { await directory.sync(); } finally { await directory.close(); }
      return result;
    } finally {
      if (temp) await rm(temp, { force: true });
      await rm(lock, { recursive: true });
    }
  }
  async readContext(): Promise<WorkflowContext> { return (await this.readHost()).readContext(); }
  async load(id: string): Promise<LocalWorkflow | undefined> { return (await this.readHost()).load(id); }
  async readLocal(destinationId: string, key: string): Promise<LocalRecord | undefined> { return (await this.readHost()).readLocal(destinationId, key); }
  async compareAndSwap(id: string, revision: number | null, next: LocalWorkflow): Promise<boolean> { return this.transaction(host => host.compareAndSwap(id, revision, next)); }
  async applyLocal(command: LocalOperationCommand): Promise<LocalRecord> { return this.transaction(host => host.applyLocal(command)); }
  async replaceContext(context: WorkflowContext): Promise<void> { return this.transaction(async host => { host.replaceContext(context); }); }
}
