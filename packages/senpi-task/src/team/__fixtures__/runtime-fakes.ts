import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema, type OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import type { DestroyCause } from "../../lifecycle"
import type { ManagerStartSpec, StartResult } from "../../manager"
import type { ResolvedModelRecord, TaskRecord, TaskStatus } from "../../state"
import type { CancelOutcome } from "../../steering"
import type { StateDirConfig } from "../../store"

const cleanupRoots: string[] = []

export function cleanupTeamRuntimeTmp(): void {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function tempProjectDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-team-runtime-"))
  cleanupRoots.push(directory)
  return directory
}

export function stateDirConfig(projectDir: string): StateDirConfig {
  return { project_dir: projectDir }
}

type TeamBoundsOverrides = {
  readonly max_members?: number
  readonly max_parallel_members?: number
  readonly max_wall_clock_minutes?: number
}

export function taskSettings(team: TeamBoundsOverrides = {}): OmoTaskSettings {
  return OmoTaskSettingsSchema.parse({
    team: { max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120, ...team },
  })
}

export type StartBehavior =
  | { readonly kind: "ok"; readonly status?: TaskStatus; readonly resolvedModel?: ResolvedModelRecord }
  | { readonly kind: "throw"; readonly message: string }
  | { readonly kind: "reject"; readonly result: StartResult }

export type FakeTeamManagerOptions = {
  readonly behaviors?: readonly StartBehavior[]
  readonly defaultBehavior?: StartBehavior
  readonly beforeCancelReturn?: (taskId: string) => Promise<void>
}

function buildRecord(taskId: string, spec: ManagerStartSpec, status: TaskStatus, resolvedModel?: ResolvedModelRecord): TaskRecord {
  const timestamp = new Date().toISOString()
  return {
    task_id: taskId,
    status,
    residency_state: "resident",
    created_at: timestamp,
    updated_at: timestamp,
    parent_session_id: spec.parent_session_id,
    root_session_id: spec.root_session_id ?? spec.parent_session_id,
    depth: spec.depth,
    execution_mode: spec.execution_mode ?? "in-process",
    model: spec.model ?? "fake/model",
    child_session_id: `sess-${taskId}`,
    notify_on_terminal: false,
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...(resolvedModel !== undefined ? { resolved_model: resolvedModel } : {}),
    ...(spec.name !== undefined ? { name: spec.name } : {}),
    ...(spec.category !== undefined ? { category: spec.category } : {}),
    ...(spec.subagent_type !== undefined ? { agent_type: spec.subagent_type } : {}),
  }
}

export class FakeDestruction {
  readonly calls: Array<{ readonly taskId: string; readonly cause: DestroyCause }> = []

  destroyResidentTask(taskId: string, cause: DestroyCause): Promise<void> {
    this.calls.push({ taskId, cause })
    return Promise.resolve()
  }
}

// Structural stand-in for the TaskManager the team runtime spawns members through. Records every
// start/cancel call and hands out deterministic st_ ids + child session ids so tests can assert the
// member -> task mapping and the rollback cancellations without a live in-process runner. cancelTask
// mirrors the production steering contract: terminal records noop instead of reporting cancelled.
export class FakeTeamManager {
  readonly started: ManagerStartSpec[] = []
  readonly cancelled: Array<{ readonly taskId: string; readonly reason?: string }> = []
  readonly #records = new Map<string, TaskRecord>()
  readonly #getHooks = new Map<string, (record: TaskRecord, readCount: number) => TaskRecord>()
  readonly #getCounts = new Map<string, number>()
  readonly #options: FakeTeamManagerOptions
  #counter = 0

  constructor(options: FakeTeamManagerOptions = {}) {
    this.#options = options
  }

  start(spec: ManagerStartSpec): Promise<StartResult> {
    const index = this.started.length
    this.started.push(spec)
    const behavior = this.#options.behaviors?.[index] ?? this.#options.defaultBehavior ?? { kind: "ok" }
    if (behavior.kind === "throw") return Promise.reject(new Error(behavior.message))
    if (behavior.kind === "reject") return Promise.resolve(behavior.result)
    this.#counter += 1
    const taskId = `st_${this.#counter.toString().padStart(6, "0")}`
    const status = behavior.status ?? "running"
    this.#records.set(taskId, buildRecord(taskId, spec, status, behavior.resolvedModel))
    return Promise.resolve({
      kind: "started",
      task_id: taskId,
      status: status === "pending" ? "pending" : "running",
      name: spec.name ?? taskId,
      ...(behavior.resolvedModel !== undefined ? { resolved_model: behavior.resolvedModel } : {}),
    })
  }

  async cancelTask(idOrName: string, reason?: string): Promise<CancelOutcome> {
    this.cancelled.push({ taskId: idOrName, ...(reason !== undefined ? { reason } : {}) })
    const record = this.#records.get(idOrName)
    if (record === undefined) return { kind: "not_found", reason: `no task ${idOrName}` }
    if (record.status !== "pending" && record.status !== "running") {
      return {
        kind: "noop",
        task_id: idOrName,
        status: record.status,
        reason: `Task ${idOrName} is ${record.status}, not running.`,
      }
    }
    this.#records.set(idOrName, { ...record, status: "cancelled", updated_at: new Date().toISOString() })
    await this.#options.beforeCancelReturn?.(idOrName)
    return { kind: "cancelled", task_id: idOrName, previous_status: record.status }
  }

  get(taskId: string): TaskRecord | undefined {
    const record = this.#records.get(taskId)
    const hook = this.#getHooks.get(taskId)
    if (record === undefined || hook === undefined) return record
    const readCount = (this.#getCounts.get(taskId) ?? 0) + 1
    this.#getCounts.set(taskId, readCount)
    const updated = hook(record, readCount)
    this.#records.set(taskId, updated)
    return updated
  }

  setGetHook(taskId: string, hook: (record: TaskRecord, readCount: number) => TaskRecord): void {
    this.#getHooks.set(taskId, hook)
    this.#getCounts.set(taskId, 0)
  }

  getResidentHandle(taskId: string): { readonly sessionId: string | undefined } | undefined {
    const record = this.#records.get(taskId)
    return record === undefined ? undefined : { sessionId: record.child_session_id }
  }

  setStatus(taskId: string, status: TaskStatus): void {
    const record = this.#records.get(taskId)
    if (record !== undefined) this.#records.set(taskId, { ...record, status })
  }

  setResidency(taskId: string, residencyState: TaskRecord["residency_state"]): void {
    const record = this.#records.get(taskId)
    if (record !== undefined) this.#records.set(taskId, { ...record, residency_state: residencyState })
  }
}
