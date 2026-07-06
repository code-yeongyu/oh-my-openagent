import { log } from "@oh-my-opencode/utils"

import { createTaskRecord, messageability, parseTaskId } from "../state"
import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { TaskConcurrency } from "./concurrency"
import { decideDepthPolicy } from "./depth-policy"
import { resolveExecutionMode, type ExecutionMode } from "./execution-mode"
import {
  CONTINUE_SUGGESTION,
  buildManagedSpec,
  buildRecordInput,
  notContinuableReason,
  nowIso,
  revivedRecord,
} from "./manager-helpers"
import { NameRegistry } from "./names"
import type {
  ContinueResult,
  ListScope,
  ListedTask,
  ManagedRunner,
  ManagedStartSpec,
  ManagerStartSpec,
  StartResult,
  TaskManager,
  TaskManagerOptions,
} from "./types"

type LiveTask = {
  readonly handle: ManagedChildHandle
  readonly model: string
}

type LaunchContext = {
  readonly record: TaskRecord
  readonly managedSpec: ManagedStartSpec
  readonly runner: ManagedRunner
  readonly model: string
}

class TaskManagerImpl implements TaskManager {
  readonly #options: TaskManagerOptions
  readonly #now: () => number
  readonly #concurrency: TaskConcurrency
  readonly #names = new NameRegistry()
  readonly #live = new Map<string, LiveTask>()
  readonly #released = new Set<string>()
  readonly #waiters = new Map<string, Array<(record: TaskRecord) => void>>()

  constructor(options: TaskManagerOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
    this.#concurrency = new TaskConcurrency({
      default_concurrency: options.config.default_concurrency,
      ...(options.config.provider_concurrency !== undefined && { provider_concurrency: options.config.provider_concurrency }),
      ...(options.config.model_concurrency !== undefined && { model_concurrency: options.config.model_concurrency }),
    })
  }

  async start(spec: ManagerStartSpec): Promise<StartResult> {
    const resolution = this.#options.planner(spec)
    if (resolution.kind === "error") return { kind: "plan_unresolved", error: resolution.error }
    const plan = resolution.plan

    const maxDepth = plan.maxDepth ?? this.#options.config.max_depth
    const allowedSubagents = [...(spec.allowed_subagents ?? []), ...(plan.allowedSubagents ?? [])]
    const targetAgentType = spec.subagent_type ?? plan.agentType
    const decision = decideDepthPolicy({
      childDepth: spec.depth,
      maxDepth,
      ...(targetAgentType !== undefined ? { targetAgentType } : {}),
      allowedSubagents,
    })
    if (!decision.allowed) {
      return { kind: "depth_denied", reason: decision.reason, child_depth: spec.depth, max_depth: maxDepth }
    }

    const executionMode: ExecutionMode = resolveExecutionMode({
      ...(spec.execution_mode !== undefined && { specMode: spec.execution_mode }),
      ...(plan.agentExecutionMode !== undefined && { agentMode: plan.agentExecutionMode }),
      configMode: this.#options.config.default_execution_mode,
    })

    const draft = createTaskRecord(buildRecordInput({ spec, plan, name: spec.name ?? "", executionMode }))
    const registration = this.#names.register(spec.parent_session_id, spec.name, draft.task_id)
    const record: TaskRecord = { ...draft, name: registration.name }
    this.#options.store.save(record)

    const managedSpec = buildManagedSpec({
      record,
      spec,
      plan,
      cwd: this.#options.cwd,
      stateDir: this.#options.store.stateDir,
    })
    const runner = this.#options.runners[executionMode]
    const context: LaunchContext = { record, managedSpec, runner, model: plan.model }
    const nameParts = registration.warning !== undefined ? { name_warning: registration.warning } : {}

    if (this.#concurrency.hasFreeSlot(plan.model)) {
      this.#concurrency.acquire(plan.model, record.task_id)
      const launched = await this.#launch(context)
      if (!launched.ok) {
        return { kind: "start_failed", task_id: record.task_id, name: registration.name, error_message: launched.error }
      }
      return { kind: "started", task_id: record.task_id, status: "running", name: registration.name, ...nameParts }
    }

    const position = this.#concurrency.enqueue(plan.model, record.task_id, () => {
      void this.#launch(context)
    })
    return {
      kind: "started",
      task_id: record.task_id,
      status: "pending",
      name: registration.name,
      queue_position: position,
      ...nameParts,
    }
  }

  async continueTask(
    taskIdOrName: string,
    prompt: string,
    deliverAs: "steer" | "followUp" = "followUp",
  ): Promise<ContinueResult> {
    const record = this.#resolveRecord(taskIdOrName)
    if (record === undefined) {
      return { kind: "not_continuable", reason: `No task found for "${taskIdOrName}".`, suggestion: CONTINUE_SUGGESTION }
    }
    const mode = messageability(record.status, record.residency_state)
    if (mode === "not-continuable") {
      return { kind: "not_continuable", task_id: record.task_id, reason: notContinuableReason(record), suggestion: CONTINUE_SUGGESTION }
    }
    const live = this.#live.get(record.task_id)
    if (live === undefined) {
      return {
        kind: "not_continuable",
        task_id: record.task_id,
        reason: `Task ${record.task_id} has no resident session in this process.`,
        suggestion: CONTINUE_SUGGESTION,
      }
    }

    if (mode === "steer") {
      if (deliverAs === "steer") await live.handle.steer(prompt)
      else await live.handle.followUp(prompt)
      return { kind: "continued", task_id: record.task_id, status: record.status, delivered: deliverAs }
    }

    await live.handle.followUp(prompt)
    const revived = revivedRecord(record, nowIso(this.#now))
    this.#options.store.replace(revived)
    this.#options.store.appendEvent(record.task_id, { type: "revived", payload: { run_epoch: revived.notification.run_epoch } })
    return { kind: "continued", task_id: record.task_id, status: "running", delivered: "revive" }
  }

  get(taskId: string): TaskRecord | undefined {
    return this.#tryLoad(taskId) ?? undefined
  }

  list(scope: ListScope): readonly ListedTask[] {
    const records = this.#options.store.list().records
    const filtered = scope.scope === "all" ? records : records.filter((record) => inSession(record, scope.session_id))
    return filtered.map((record) => {
      const position = record.status === "pending" ? this.#concurrency.queuePosition(record.model, record.task_id) : undefined
      return position === undefined ? { record } : { record, queue_position: position }
    })
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    const id = parseTaskId(taskId)
    const current = this.#tryLoad(id)
    if (current !== null && current !== undefined && isTerminal(current)) return Promise.resolve(current)
    return new Promise((resolve) => {
      const list = this.#waiters.get(id) ?? []
      list.push(resolve)
      this.#waiters.set(id, list)
    })
  }

  async #launch(context: LaunchContext): Promise<{ ok: true } | { ok: false; error: string }> {
    const { record, managedSpec, runner, model } = context
    this.#options.store.transition(record.task_id, { type: "start", timestamp: nowIso(this.#now) })

    let handle: ManagedChildHandle
    try {
      handle = await runner.start(managedSpec)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#releaseSlot(record.task_id, model)
      this.#options.store.transition(record.task_id, { type: "fail", timestamp: nowIso(this.#now), error_message: message })
      this.#options.store.appendEvent(record.task_id, { type: "task_start_failed", payload: { error_message: message } })
      this.#settleWaiters(record.task_id)
      return { ok: false, error: message }
    }

    this.#live.set(record.task_id, { handle, model })
    this.#trackOutcome(record.task_id, handle, model)
    return { ok: true }
  }

  #trackOutcome(taskId: string, handle: ManagedChildHandle, model: string): void {
    handle
      .waitForOutcome()
      .then((outcome) => {
        this.#releaseSlot(taskId, model)
        const timestamp = nowIso(this.#now)
        if (outcome.status === "completed") {
          this.#options.store.transition(taskId, { type: "complete", timestamp, final_response: outcome.finalResponse })
        } else if (outcome.status === "cancelled") {
          this.#options.store.transition(taskId, { type: "cancel", timestamp })
        } else {
          this.#options.store.transition(taskId, { type: "fail", timestamp, error_message: outcome.failure.message })
        }
        this.#settleWaiters(taskId)
      })
      .catch((error: unknown) => log("senpi-task manager outcome tracking failed", { taskId, error: String(error) }))
  }

  #releaseSlot(taskId: string, model: string): void {
    if (this.#released.has(taskId)) return
    this.#released.add(taskId)
    this.#concurrency.release(model)
  }

  #settleWaiters(taskId: string): void {
    const record = this.#tryLoad(taskId)
    if (record === null || record === undefined) return
    for (const resolve of this.#waiters.get(taskId)?.splice(0) ?? []) resolve(record)
  }

  #resolveRecord(taskIdOrName: string): TaskRecord | undefined {
    const byId = this.#tryLoad(taskIdOrName)
    if (byId !== null && byId !== undefined) return byId
    return this.#options.store.list().records.find((record) => record.name === taskIdOrName)
  }

  #tryLoad(taskId: string): TaskRecord | null {
    try {
      return this.#options.store.load(taskId)
    } catch {
      return null
    }
  }
}

function inSession(record: TaskRecord, sessionId: string): boolean {
  return record.parent_session_id === sessionId || record.root_session_id === sessionId
}

function isTerminal(record: TaskRecord): boolean {
  return (
    record.status === "completed" ||
    record.status === "error" ||
    record.status === "cancelled" ||
    record.status === "interrupted" ||
    record.status === "lost"
  )
}

export function createTaskManager(options: TaskManagerOptions): TaskManager {
  return new TaskManagerImpl(options)
}
