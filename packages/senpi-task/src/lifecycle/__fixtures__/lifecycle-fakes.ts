import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema, type OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import type { ResidencyState, TaskRecord, TaskStatus } from "../../state"
import { createTaskRecordStore } from "../../store"
import type { TaskRecordStore } from "../../store"
import type { ResidentHandle, ResidencyRegistry } from "../port"

const cleanupRoots: string[] = []

export function cleanupProjects(): void {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function tempStore(): TaskRecordStore {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-lifecycle-"))
  cleanupRoots.push(directory)
  return createTaskRecordStore({ project_dir: directory })
}

export function settings(overrides: Record<string, unknown> = {}): OmoTaskSettings {
  return OmoTaskSettingsSchema.parse(overrides)
}

export type SeedInput = {
  readonly task_id: string
  readonly parent_session_id?: string
  readonly status?: TaskStatus
  readonly residency_state?: ResidencyState
  readonly execution_mode?: string
  readonly updated_at?: string
  readonly pid?: number
  readonly child_session_id?: string
  readonly host_pid?: number
}

// Write a persisted record at an exact status/residency/timestamp so lifecycle logic can be driven
// deterministically without running a real child.
export function seedRecord(store: TaskRecordStore, input: SeedInput): TaskRecord {
  const timestamp = input.updated_at ?? new Date().toISOString()
  const record: TaskRecord = {
    task_id: input.task_id,
    name: input.task_id,
    parent_session_id: input.parent_session_id ?? "parent-1",
    root_session_id: input.parent_session_id ?? "parent-1",
    depth: 1,
    execution_mode: input.execution_mode ?? "in-process",
    model: "anthropic/claude",
    status: input.status ?? "completed",
    residency_state: input.residency_state ?? "resident",
    created_at: timestamp,
    updated_at: timestamp,
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...(input.pid !== undefined ? { pid: input.pid } : {}),
    ...(input.child_session_id !== undefined ? { child_session_id: input.child_session_id } : {}),
    ...(input.host_pid !== undefined ? { host_pid: input.host_pid } : {}),
  }
  store.save(record)
  return record
}

export type CallLog = string[]

export type FakeHandle = ResidentHandle & {
  readonly aborted: () => boolean
  readonly disposed: () => boolean
  readonly terminated: () => boolean
}

export function fakeHandle(
  taskId: string,
  kind: "in-process" | "rpc",
  order: CallLog,
  options: { pid?: number; abortRejects?: boolean; disposeRejects?: boolean } = {},
): FakeHandle {
  let didAbort = false
  let didDispose = false
  let didTerminate = false
  return {
    task_id: taskId,
    kind,
    pid: options.pid,
    abort: async () => {
      didAbort = true
      order.push(`abort:${taskId}`)
      if (options.abortRejects === true) throw new Error("child already exited")
    },
    dispose: async () => {
      didDispose = true
      order.push(`dispose:${taskId}`)
      if (options.disposeRejects === true) throw new Error("dispose failed")
    },
    terminate: async () => {
      didTerminate = true
      order.push(`terminate:${taskId}`)
    },
    aborted: () => didAbort,
    disposed: () => didDispose,
    terminated: () => didTerminate,
  }
}

export class FakeRegistry implements ResidencyRegistry {
  readonly #handles = new Map<string, ResidentHandle>()
  readonly #pending = new Set<string>()
  readonly forgotten: string[] = []

  add(handle: ResidentHandle): void {
    this.#handles.set(handle.task_id, handle)
  }

  markPending(taskId: string): void {
    this.#pending.add(taskId)
  }

  get(taskId: string): ResidentHandle | undefined {
    return this.#handles.get(taskId)
  }

  entries(): readonly ResidentHandle[] {
    return [...this.#handles.values()]
  }

  forget(taskId: string): void {
    this.#handles.delete(taskId)
    this.forgotten.push(taskId)
  }

  hasPendingSends(taskId: string): boolean {
    return this.#pending.has(taskId)
  }
}

export function readEvents(store: TaskRecordStore, taskId: string): string[] {
  const path = join(store.stateDir, "logs", `${taskId}.jsonl`)
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line: string) => line.length > 0)
      .map((line: string) => (JSON.parse(line) as { type: string }).type)
  } catch {
    return []
  }
}
