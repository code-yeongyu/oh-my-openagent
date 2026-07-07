import { log } from "@oh-my-opencode/utils"

import { createTaskRecord, parseTaskId } from "../state"
import type { TaskRecord } from "../state"
import { createSteeringEngine } from "../steering"
import type { CancelOutcome, DestructionPort, InterruptOutcome, SendInput, SendOutcome, SteeringEngine, SteeringPort } from "../steering"
import type { ManagedChildHandle } from "./child-handle"
import { TaskConcurrency } from "./concurrency"
import { decideDepthPolicy } from "./depth-policy"
import { resolveExecutionMode, type ExecutionMode } from "./execution-mode"
import { toContinueResult } from "./continue-result"
import {
  buildManagedSpec,
  buildRecordInput,
  inSession,
  isTerminalRecord,
  nowIso,
  recordSpawnedPid,
} from "./manager-helpers"
import { NameRegistry } from "./names"
import { subscribeTranscriptLog } from "./transcript-log"
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

const NOOP_DESTRUCTION: DestructionPort = { destroyResidentTask: () => Promise.resolve() }

class TaskManagerImpl implements TaskManager {
  readonly #options: TaskManagerOptions
  readonly #now: () => number
  readonly #concurrency: TaskConcurrency
  readonly #names = new NameRegistry()
  readonly #live = new Map<string, LiveTask>()
  // Release guard keyed by `${taskId}:${runEpoch}` so a revived task (new epoch) can re-acquire a
  // slot and still have its LATER release counted instead of swallowed by an already-released id.
  readonly #released = new Set<string>()
  readonly #waiters = new Map<string, Array<(record: TaskRecord) => void>>()
  readonly #background = new Set<string>()
  readonly #steering: SteeringEngine

  constructor(options: TaskManagerOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
    this.#concurrency = new TaskConcurrency({
      default_concurrency: options.config.default_concurrency,
      ...(options.config.provider_concurrency !== undefined && { provider_concurrency: options.config.provider_concurrency }),
      ...(options.config.model_concurrency !== undefined && { model_concurrency: options.config.model_concurrency }),
    })
    const port: SteeringPort = {
      store: options.store,
      liveHandle: (taskId) => this.#live.get(taskId)?.handle,
      reacquireForRevive: (taskId) => this.#reacquireForRevive(taskId),
      destruction: options.destruction ?? NOOP_DESTRUCTION,
      now: this.#now,
    }
    this.#steering = createSteeringEngine(port)
  }

  async start(spec: ManagerStartSpec): Promise<StartResult> {
    const resolution = this.#options.planner(spec)
    if (resolution.kind === "error") return { kind: "plan_unresolved", error: resolution.error }
    const plan = resolution.plan

    if (this.#options.admit !== undefined) {
      const admission = await this.#options.admit(spec.parent_session_id)
      if (admission.kind === "rejected") return { kind: "residency_denied", reason: admission.message }
    }

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
    if (spec.run_in_background === true) this.#background.add(record.task_id)
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
    const outcome = await this.#steering.sendToTask({ idOrName: taskIdOrName, message: prompt, deliverAs })
    return toContinueResult(outcome)
  }

  sendToTask(input: SendInput): Promise<SendOutcome> {
    return this.#steering.sendToTask(input)
  }

  async interruptTask(idOrName: string): Promise<InterruptOutcome> {
    const outcome = await this.#steering.interruptTask(idOrName)
    if (outcome.kind === "interrupted") this.#releaseSlotForTask(outcome.task_id)
    return outcome
  }

  async cancelTask(idOrName: string, reason?: string): Promise<CancelOutcome> {
    const outcome = await this.#steering.cancelTask(idOrName, reason)
    if (outcome.kind === "cancelled") this.#releaseSlotForTask(outcome.task_id)
    return outcome
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

  forget(taskId: string): void {
    this.#live.delete(taskId)
    this.#background.delete(taskId)
    for (const key of this.#released) if (key.startsWith(`${taskId}:`)) this.#released.delete(key)
  }

  getResidentHandle(taskId: string): ManagedChildHandle | undefined { return this.#live.get(taskId)?.handle }

  residentTaskIds(): readonly string[] { return [...this.#live.keys()] }

  wasBackground(taskId: string): boolean { return this.#background.has(taskId) }

  waitFor(taskId: string): Promise<TaskRecord> {
    const id = parseTaskId(taskId)
    const current = this.#tryLoad(id)
    if (current !== null && current !== undefined && isTerminalRecord(current)) return Promise.resolve(current)
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
      this.#releaseSlot(record.task_id, model, record.notification.run_epoch)
      this.#options.store.transition(record.task_id, { type: "fail", timestamp: nowIso(this.#now), error_message: message })
      this.#options.store.appendEvent(record.task_id, { type: "task_start_failed", payload: { error_message: message } })
      this.#settleWaiters(record.task_id)
      return { ok: false, error: message }
    }

    this.#live.set(record.task_id, { handle, model })
    this.#recordSpawnFacts(record.task_id, handle)
    subscribeTranscriptLog(handle, this.#options.store, record.task_id)
    this.#trackOutcome(record.task_id, handle, model, record.notification.run_epoch)
    void this.#steering.notifyStarted(record.task_id)
    return { ok: true }
  }

  // Persist the spawned child's OS pid onto the running record so task_output(status) and session_start
  // reconciliation can see (and, for an orphan, signal) the live process. The pure decision lives in
  // recordSpawnedPid; in-process children (no pid) and already-terminal records are left untouched.
  #recordSpawnFacts(taskId: string, handle: ManagedChildHandle): void {
    const current = this.#tryLoad(taskId)
    if (current === null) return
    const updated = recordSpawnedPid(current, handle.pid)
    if (updated !== undefined) this.#options.store.replace(updated)
  }

  #trackOutcome(taskId: string, handle: ManagedChildHandle, model: string, epoch: number): void {
    handle
      .waitForOutcome()
      .then((outcome) => {
        this.#releaseSlot(taskId, model, epoch)
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

  // A revived child is running again and SHOULD occupy a slot; re-acquire it and re-arm outcome
  // tracking under the new run_epoch so the eventual second completion releases the slot cleanly.
  #reacquireForRevive(taskId: string): void {
    const live = this.#live.get(taskId)
    if (live === undefined) return
    const record = this.#tryLoad(taskId)
    const epoch = record?.notification.run_epoch ?? 0
    this.#concurrency.acquire(live.model, taskId)
    this.#trackOutcome(taskId, live.handle, live.model, epoch)
  }

  #releaseSlot(taskId: string, model: string, epoch: number): void {
    const key = `${taskId}:${epoch}`
    if (this.#released.has(key)) return
    this.#released.add(key)
    this.#concurrency.release(model)
  }

  #releaseSlotForTask(taskId: string): void {
    const live = this.#live.get(taskId)
    if (live === undefined) return
    const epoch = this.#tryLoad(taskId)?.notification.run_epoch ?? 0
    this.#releaseSlot(taskId, live.model, epoch)
  }

  #settleWaiters(taskId: string): void {
    const record = this.#tryLoad(taskId)
    if (record === null || record === undefined) return
    for (const resolve of this.#waiters.get(taskId)?.splice(0) ?? []) resolve(record)
  }

  #tryLoad(taskId: string): TaskRecord | null {
    try {
      return this.#options.store.load(taskId)
    } catch {
      return null
    }
  }
}

export function createTaskManager(options: TaskManagerOptions): TaskManager {
  return new TaskManagerImpl(options)
}
