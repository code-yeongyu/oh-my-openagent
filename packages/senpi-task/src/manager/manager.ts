import { join } from "node:path"
import { log } from "@oh-my-opencode/utils"

import { registerLifecycleReattachPorts, type ReattachResult, type RespawnResult } from "../lifecycle/port"
import { RunnerError } from "../runners/in-process/runner-error"
import { RpcProcessRunner } from "../runners/rpc-process"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { createTaskRecord, parseTaskId, syncTaskIdFloor } from "../state"
import type { TaskRecord } from "../state"
import { createSteeringEngine } from "../steering"
import type { CancelOutcome, DestructionPort, InterruptOutcome, SendInput, SendOutcome, SteeringEngine, SteeringPort } from "../steering"
import { adaptRpcHandle, discardManagedHandle, discardRpcHandle, type ManagedChildHandle } from "./child-handle"
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
  readonly unsubscribe: () => void
}

type LaunchContext = {
  readonly record: TaskRecord
  readonly managedSpec: ManagedStartSpec
  readonly runner: ManagedRunner
  readonly model: string
}

type TaskWaiter = {
  readonly resolve: (record: TaskRecord) => void
  readonly reject: (reason: unknown) => void
  readonly cleanup: () => void
}

type RpcRespawnRunner = {
  start(spec: RpcRunnerSpec): RpcChildHandle
}

type TaskManagerImplOptions = TaskManagerOptions & {
  readonly rpcRespawnRunner?: RpcRespawnRunner
}

type ReattachingTaskManager = TaskManager & {
  respawn(record: TaskRecord, resumeSessionPath: string): Promise<RespawnResult>
  reattach(record: TaskRecord, handle: ManagedChildHandle): Promise<ReattachResult>
  waiterKeyCount(): number
  releasedKeyCount(): number
}

const NOOP_DESTRUCTION: DestructionPort = { destroyResidentTask: () => Promise.resolve() }
const GENERIC_START_FAILURE_MESSAGE = "Task runner failed to start."
const RESPAWN_CLEANUP_FAILURE_REASON = "rpc respawn cleanup failed"

function publicStartFailureMessage(error: unknown): string {
  try {
    if (!RunnerError.is(error)) return GENERIC_START_FAILURE_MESSAGE
    switch (error.failure.kind) {
      case "depth-exceeded":
        return "In-process child depth limit exceeded."
      case "session-create-failed":
        return "In-process child session creation failed."
      case "child-prompt-failed":
        return "In-process child prompt failed to start."
      default:
        return GENERIC_START_FAILURE_MESSAGE
    }
  } catch {
    return GENERIC_START_FAILURE_MESSAGE
  }
}

// allow: SIZE_OK - one stateful manager keeps concurrency, queue, live-handle, and waiter invariants in one closure-backed implementation.
class TaskManagerImpl implements TaskManager {
  readonly #options: TaskManagerImplOptions
  readonly #now: () => number
  readonly #concurrency: TaskConcurrency
  readonly #rpcRespawnRunner: RpcRespawnRunner
  readonly #names = new NameRegistry()
  readonly #live = new Map<string, LiveTask>()
  // Release guard: latest released run_epoch per task_id. A revived task (higher epoch) can still
  // release its LATER occupancy, while a stale re-release of an already-released epoch is a no-op.
  // Keyed by task_id (not `${taskId}:${epoch}`) so growth is bounded by live tasks and forget()
  // prunes in O(1).
  readonly #released = new Map<string, number>()
  readonly #waiters = new Map<string, TaskWaiter[]>()
  readonly #background = new Set<string>()
  readonly #steering: SteeringEngine

  constructor(options: TaskManagerImplOptions) {
    this.#options = options
    try {
      const listed = options.store.list()
      if (listed.diagnostics.length > 0) {
        log("senpi-task manager task record diagnostics while seeding id floor", { count: listed.diagnostics.length })
      }
      const maxId = listed.records.reduce<string | undefined>(
        (maximum, record) => (maximum === undefined || record.task_id > maximum ? record.task_id : maximum),
        undefined,
      )
      if (maxId !== undefined) syncTaskIdFloor(parseTaskId(maxId))
    } catch (error) {
      log("senpi-task manager failed to seed task id floor", { error: String(error) })
    }
    this.#now = options.now ?? Date.now
    this.#rpcRespawnRunner = options.rpcRespawnRunner ?? new RpcProcessRunner()
    this.#concurrency = new TaskConcurrency({
      default_concurrency: options.config.default_concurrency,
      ...(options.config.provider_concurrency !== undefined && { provider_concurrency: options.config.provider_concurrency }),
      ...(options.config.model_concurrency !== undefined && { model_concurrency: options.config.model_concurrency }),
    })
    const port: SteeringPort = {
      store: options.store,
      liveHandle: (taskId) => this.#live.get(taskId)?.handle,
      dequeuePending: (taskId) => {
        const rec = this.#tryLoad(taskId)
        if (rec === null || rec === undefined) return false
        const removed = this.#concurrency.remove(rec.model, taskId)
        this.#background.delete(taskId)
        this.#settleWaiters(taskId)
        return removed
      },
      reacquireForRevive: (taskId) => this.#reacquireForRevive(taskId),
      destruction: options.destruction ?? NOOP_DESTRUCTION,
      now: this.#now,
    }
    this.#steering = createSteeringEngine(port)
    registerLifecycleReattachPorts(options.store, {
      respawn: (record, resumeSessionPath) => this.respawn(record, resumeSessionPath),
      reattach: (record, handle) => this.reattach(record, handle),
    })
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
    const persistedRecord: TaskRecord = executionMode === "process"
      ? {
          ...record,
          spawn_spec: {
            cwd: managedSpec.cwd,
            ...(managedSpec.extensions === undefined ? {} : { extensions: managedSpec.extensions }),
            ...(managedSpec.memberEnv === undefined ? {} : { member_env: managedSpec.memberEnv }),
          },
        }
      : record
    if (persistedRecord !== record) this.#options.store.replace(persistedRecord)
    const runner = this.#options.runners[executionMode]
    const context: LaunchContext = { record: persistedRecord, managedSpec, runner, model: plan.model }
    const startParts = {
      ...(plan.resolved_model !== undefined ? { resolved_model: plan.resolved_model } : {}),
      ...(registration.warning !== undefined ? { name_warning: registration.warning } : {}),
    }

    if (this.#concurrency.hasFreeSlot(plan.model)) {
      this.#concurrency.acquire(plan.model, record.task_id)
      const launched = await this.#launch(context)
      if (!launched.ok) {
        return {
          kind: "start_failed",
          task_id: record.task_id,
          name: registration.name,
          ...(record.category !== undefined ? { category: record.category } : {}),
          ...(record.agent_type !== undefined ? { subagent_type: record.agent_type } : {}),
          execution_mode: executionMode,
          model: record.model,
          ...(record.resolved_model !== undefined ? { resolved_model: record.resolved_model } : {}),
          run_in_background: spec.run_in_background === true,
          error_message: launched.error,
        }
      }
      return { kind: "started", task_id: record.task_id, status: "running", name: registration.name, ...startParts }
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
      ...startParts,
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
    this.#live.get(taskId)?.unsubscribe()
    this.#live.delete(taskId)
    this.#background.delete(taskId)
    this.#released.delete(taskId)
    this.#steering.dropPending(taskId)
  }

  getResidentHandle(taskId: string): ManagedChildHandle | undefined { return this.#live.get(taskId)?.handle }

  residentTaskIds(): readonly string[] { return [...this.#live.keys()] }

  wasBackground(taskId: string): boolean { return this.#background.has(taskId) }

  async respawn(record: TaskRecord, resumeSessionPath: string): Promise<RespawnResult> {
    const spawnSpec = record.spawn_spec
    if (spawnSpec === undefined) return { ok: false, reason: "persisted spawn spec unavailable" }

    let handle: RpcChildHandle | undefined
    try {
      const trustedLaunch = this.#options.trustedRespawnLaunch === undefined
        ? undefined
        : await this.#options.trustedRespawnLaunch(record)
      handle = this.#rpcRespawnRunner.start({
        task_id: record.task_id,
        cwd: spawnSpec.cwd,
        state_dir: join(this.#options.store.stateDir, "children", record.task_id),
        prompt: "",
        resumeSessionPath,
        model: record.model,
        ...(trustedLaunch?.extensions === undefined ? {} : { extensions: trustedLaunch.extensions }),
        ...(trustedLaunch?.memberEnv === undefined ? {} : { memberEnv: trustedLaunch.memberEnv }),
      })
      const switchSession = handle.switchSession
      if (switchSession === undefined) {
        if (!(await this.#disposeFailedRespawn(handle))) return { ok: false, reason: RESPAWN_CLEANUP_FAILURE_REASON }
        return { ok: false, reason: "respawned RPC handle cannot switch sessions" }
      }
      const switched = await switchSession(resumeSessionPath)
      if (switched.cancelled) {
        if (!(await this.#disposeFailedRespawn(handle))) return { ok: false, reason: RESPAWN_CLEANUP_FAILURE_REASON }
        return { ok: false, reason: "switch_session was cancelled" }
      }
      return { ok: true, handle: adaptRpcHandle(handle) }
    } catch (error) { // no-excuse-ok: catch - RPC respawn boundary converts failures into a typed result.
      const cleanedUp = handle === undefined || await this.#disposeFailedRespawn(handle)
      log("senpi-task rpc respawn failed", { taskId: record.task_id, error: String(error) })
      return { ok: false, reason: cleanedUp ? "rpc respawn failed" : RESPAWN_CLEANUP_FAILURE_REASON }
    }
  }

  async reattach(record: TaskRecord, handle: ManagedChildHandle): Promise<ReattachResult> {
    if (this.#live.has(record.task_id)) {
      await discardManagedHandle(handle)
      return { ok: false, kind: "already_attached", reason: "task already has a live handle" }
    }
    let unsubscribe: (() => void) | undefined
    let acquiredEpoch: number | undefined
    try {
      unsubscribe = subscribeTranscriptLog(handle, this.#options.store, record.task_id)
      this.#live.set(record.task_id, { handle, model: record.model, unsubscribe })
      if (isTerminalRecord(record) && record.status !== "lost") {
        this.#options.store.replace({
          ...record,
          residency_state: "resident",
          updated_at: nowIso(this.#now),
          ...(handle.pid === undefined ? {} : { pid: handle.pid }),
        })
        return { ok: true }
      }

      const { error_message: _error, final_response: _final, killed: _killed, ...rest } = record
      const reattached: TaskRecord = {
        ...rest,
        status: "running",
        residency_state: "resident",
        updated_at: nowIso(this.#now),
        notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 },
        ...(handle.pid === undefined ? {} : { pid: handle.pid }),
      }
      this.#options.store.replace(reattached)
      acquiredEpoch = reattached.notification.run_epoch
      this.#concurrency.acquire(record.model, record.task_id)
      this.#trackOutcome(record.task_id, handle, record.model, acquiredEpoch)
      return { ok: true }
    } catch (error) { // no-excuse-ok: catch - ownership-transfer boundary converts setup failure into a typed result.
      unsubscribe?.()
      if (this.#live.get(record.task_id)?.handle === handle) this.#live.delete(record.task_id)
      if (acquiredEpoch !== undefined) this.#releaseSlot(record.task_id, record.model, acquiredEpoch)
      await discardManagedHandle(handle)
      log("senpi-task rpc reattach failed", { taskId: record.task_id, error: String(error) })
      return { ok: false, kind: "failed", reason: "manager reattach failed" }
    }
  }

  waitFor(taskId: string, options?: { readonly signal?: AbortSignal }): Promise<TaskRecord> {
    const signal = options?.signal
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("waitFor aborted"))
    const id = parseTaskId(taskId)
    const current = this.#tryLoad(id)
    if (current !== null && current !== undefined && isTerminalRecord(current)) return Promise.resolve(current)
    const list = this.#waiters.get(id) ?? []
    if (signal === undefined) {
      // task_output races completion.then() against a timeout without a catch; keeping this path
      // resolve-only is safe until that caller starts passing an AbortSignal.
      return new Promise((resolve) => {
        list.push({ resolve, reject: () => undefined, cleanup: () => undefined })
        this.#waiters.set(id, list)
      })
    }
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const index = list.indexOf(waiter)
        if (index < 0) return
        list.splice(index, 1)
        if (list.length === 0) this.#waiters.delete(id)
        waiter.reject(signal.reason ?? new Error("waitFor aborted"))
      }
      const waiter: TaskWaiter = {
        resolve,
        reject,
        cleanup: () => signal.removeEventListener("abort", onAbort),
      }
      list.push(waiter)
      this.#waiters.set(id, list)
      signal.addEventListener("abort", onAbort, { once: true })
    })
  }

  // Test-only observability for proving waitFor never retains empty waiter-map keys.
  waiterKeyCount(): number { return this.#waiters.size }

  // Test-only observability for proving the release guard never grows unboundedly across revives.
  releasedKeyCount(): number { return this.#released.size }

  async #disposeFailedRespawn(handle: RpcChildHandle): Promise<boolean> {
    try {
      await discardRpcHandle(handle)
      return true
    } catch (error) { // no-excuse-ok: catch - cleanup failure is logged and returned through RespawnResult.
      log("senpi-task failed respawn cleanup rejected", { taskId: handle.task_id, error: String(error) })
      return false
    }
  }

  async #launch(context: LaunchContext): Promise<{ ok: true } | { ok: false; error: string }> {
    const { record, managedSpec, runner, model } = context
    const startResult = this.#options.store.transition(record.task_id, { type: "start", timestamp: nowIso(this.#now) })
    if (!startResult.applied) {
      this.#releaseSlot(record.task_id, model, record.notification.run_epoch)
      this.#steering.dropPending(record.task_id)
      this.#settleWaiters(record.task_id)
      return { ok: false, error: "task was cancelled before launch" }
    }

    let handle: ManagedChildHandle
    try {
      handle = await runner.start(managedSpec)
    } catch (error) { // no-excuse-ok: catch - runner boundary converts every thrown value into a public classification.
      const message = publicStartFailureMessage(error)
      this.#releaseSlot(record.task_id, model, record.notification.run_epoch)
      this.#options.store.transition(record.task_id, { type: "fail", timestamp: nowIso(this.#now), error_message: message })
      this.#options.store.appendEvent(record.task_id, { type: "task_start_failed", payload: { error_message: message } })
      this.#steering.dropPending(record.task_id)
      this.#settleWaiters(record.task_id)
      return { ok: false, error: message }
    }

    const current = this.#tryLoad(record.task_id)
    if (current?.status === "cancelled") {
      this.#live.set(record.task_id, { handle, model, unsubscribe: () => undefined })
      await (this.#options.destruction ?? NOOP_DESTRUCTION).destroyResidentTask(record.task_id, "cancel")
      this.#releaseSlot(record.task_id, model, record.notification.run_epoch)
      this.#settleWaiters(record.task_id)
      return { ok: false, error: "task was cancelled during launch" }
    }

    const unsubscribe = subscribeTranscriptLog(handle, this.#options.store, record.task_id)
    this.#live.set(record.task_id, { handle, model, unsubscribe })
    this.#recordSpawnFacts(record.task_id, handle)
    this.#trackOutcome(record.task_id, handle, model, record.notification.run_epoch)
    void this.#steering.notifyStarted(record.task_id)
    return { ok: true }
  }

  // Persist the spawned child's OS pid onto the running record so task_output(status) and session_start
  // reconciliation can see (and, for an orphan, signal) the live process. The pure decision lives in
  // recordSpawnedPid; in-process children (no pid) and already-terminal records are left untouched.
  #recordSpawnFacts(taskId: string, handle: ManagedChildHandle): void {
    const current = this.#tryLoad(taskId)
    if (current === null || isTerminalRecord(current)) return
    const withPid = recordSpawnedPid(current, handle.pid) ?? current
    const spawnSpec = handle.spawnSpec
    const updated: TaskRecord = spawnSpec === undefined
      ? withPid
      : {
          ...withPid,
          spawn_spec: {
            cwd: spawnSpec.cwd,
            ...(spawnSpec.extensions === undefined ? {} : { extensions: spawnSpec.extensions }),
            ...(spawnSpec.memberEnv === undefined ? {} : { member_env: spawnSpec.memberEnv }),
          },
        }
    if (updated !== current) this.#options.store.replace(updated)
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
          this.#options.store.transition(taskId, {
            type: "fail",
            timestamp,
            error_message: outcome.failure.message,
            ...(outcome.killed === true ? { killed: true } : {}),
          })
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
    // Release once per (task, epoch). A stale re-release of an already-released epoch is a no-op;
    // a revived task's higher epoch supersedes the prior one so its later release still counts.
    const released = this.#released.get(taskId)
    if (released !== undefined && released >= epoch) return
    this.#released.set(taskId, epoch)
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
    const waiters = this.#waiters.get(taskId)
    if (waiters === undefined) return
    const settling = waiters.splice(0)
    if (waiters.length === 0) this.#waiters.delete(taskId)
    for (const waiter of settling) {
      waiter.cleanup()
      waiter.resolve(record)
    }
  }

  #tryLoad(taskId: string): TaskRecord | null {
    try {
      return this.#options.store.load(taskId)
    } catch {
      return null
    }
  }
}

export function createTaskManager(options: TaskManagerImplOptions): ReattachingTaskManager {
  return new TaskManagerImpl(options)
}
