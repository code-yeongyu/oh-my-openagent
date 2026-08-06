import { log } from "@oh-my-opencode/utils"

import { registerLifecycleReattachPorts, type ReattachResult, type RespawnResult } from "../lifecycle/port"
import { RunnerError } from "../runners/in-process/runner-error"
import { RpcProcessRunner } from "../runners/rpc-process"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { createTaskRecord, isSpawnSpecV1, parseTaskId, syncTaskIdFloor } from "../state"
import { resolvedReasoningFields } from "../state/resolved-reasoning"
import { TaskIdSpaceExhaustedError } from "../state/id"
import type { TaskRecord, TaskRunStats } from "../state"
import { createSteeringEngine } from "../steering"
import type { CancelOutcome, DestructionPort, InterruptOutcome, SendInput, SendOutcome, SteeringEngine, SteeringPort } from "../steering"
import { discardManagedHandle, type ManagedChildHandle, type ManagedChildListener } from "./child-handle"
import { TaskConcurrency } from "./concurrency"
import { decideDepthPolicy } from "./depth-policy"
import { onceOnly } from "./once-only"
import { resolveExecutionMode, type ExecutionMode } from "./execution-mode"
import { toContinueResult } from "./continue-result"
import {
  buildManagedSpec,
  buildRecordInput,
  buildSpawnSpecV1,
  inSession,
  isTerminalRecord,
  nowIso,
  recordSpawnedPid,
} from "./manager-helpers"
import { createOutcomeTracker, type OutcomeTracker } from "./manager-outcome"
import { claimTaskRecord, TaskRecordCollisionError } from "../store"
import { reattachManagedTask, respawnManagedTask } from "./manager-respawn"
import { NameRegistry } from "./names"
import { createRunStatsTracker, type RunStatsTracker } from "../run-stats"
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
  readonly managedSpec?: ManagedStartSpec
  readonly runner?: ManagedRunner
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
  respawn(record: TaskRecord, resumeSessionPath?: string): Promise<RespawnResult>
  reattach(record: TaskRecord, handle: ManagedChildHandle): Promise<ReattachResult>
  waiterKeyCount(): number
  releasedKeyCount(): number
}

const NOOP_DESTRUCTION: DestructionPort = { destroyResidentTask: () => Promise.resolve() }
const GENERIC_START_FAILURE_MESSAGE = "Task runner failed to start."

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
  readonly #runStats = new Map<string, RunStatsTracker>()
  readonly #hostPid: number
  readonly #concurrency: TaskConcurrency
  readonly #rpcRespawnRunner: RpcRespawnRunner
  readonly #names = new NameRegistry()
  readonly #live = new Map<string, LiveTask>()
  // Callers can subscribe before a queued task owns a handle. Each entry is attached exactly once
  // when #launch promotes it, and its returned cleanup owns both pending and live subscriptions.
  readonly #childSubscribers = new Map<string, Map<ManagedChildListener, () => void>>()
  // Release guard: latest released run_epoch per task_id. A revived task (higher epoch) can still
  // release its LATER occupancy, while a stale re-release of an already-released epoch is a no-op.
  // Keyed by task_id (not `${taskId}:${epoch}`) so growth is bounded by live tasks and forget()
  // prunes in O(1).
  readonly #released = new Map<string, number>()
  readonly #waiters = new Map<string, TaskWaiter[]>()
  readonly #background = new Set<string>()
  readonly #steering: SteeringEngine
  readonly #outcome: OutcomeTracker

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
    this.#hostPid = options.hostPid ?? process.pid
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
      runStatsSnapshot: (taskId) => this.#runStats.get(taskId)?.snapshot(this.#now()),
      now: this.#now,
    }
    this.#steering = createSteeringEngine(port)
    this.#outcome = createOutcomeTracker({
      store: options.store,
      now: this.#now,
      liveHandle: (taskId) => this.#live.get(taskId)?.handle,
      tryLoad: (taskId) => this.#tryLoad(taskId),
      runStatsSnapshot: (taskId) => this.#runStats.get(taskId)?.snapshot(this.#now()),
      releaseSlot: (taskId, model, epoch) => this.#releaseSlot(taskId, model, epoch),
      settleWaiters: (taskId) => this.#settleWaiters(taskId),
      tryRuntimeFallback: (input) => this.#tryRuntimeFallback(input),
    })
    registerLifecycleReattachPorts(options.store, {
      respawn: (record, resumeSessionPath) => this.respawn(record, resumeSessionPath),
      reattach: (record, handle) => this.reattach(record, handle),
    })
  }

  async start(spec: ManagerStartSpec): Promise<StartResult> {
    const normalizeSpecName = (value: string | undefined): string | undefined => {
      const trimmed = value?.trim()
      return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
    }

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

    const requestedName = normalizeSpecName(spec.name)
    const requestedRegistration = requestedName === undefined
      ? undefined
      : this.#names.register(spec.parent_session_id, requestedName)

    let claimed: TaskRecord
    try {
      const draft = createTaskRecord(buildRecordInput({ spec, plan, name: "", executionMode }), this.#now())
      const claimDraft: TaskRecord = { ...draft, name: requestedRegistration?.name ?? draft.task_id, host_pid: this.#hostPid }
      claimed = claimTaskRecord(this.#options.store, claimDraft, {
        nameFollowsId: requestedRegistration === undefined,
        ...(requestedRegistration === undefined
          ? { nameAvailable: (name) => this.#names.isAvailable(spec.parent_session_id, name) }
          : {}),
      })
    } catch (error) {
      if (!(error instanceof TaskRecordCollisionError) && !(error instanceof TaskIdSpaceExhaustedError)) throw error
      if (requestedRegistration !== undefined) this.#names.release(spec.parent_session_id, requestedRegistration.name)
      return {
        kind: "start_failed",
        task_id: "",
        name: requestedName ?? "",
        ...(spec.category ?? plan.category !== undefined ? { category: spec.category ?? plan.category } : {}),
        ...(spec.subagent_type ?? plan.agentType !== undefined ? { subagent_type: spec.subagent_type ?? plan.agentType } : {}),
        execution_mode: executionMode,
        model: plan.model,
        ...(plan.resolved_model !== undefined ? { resolved_model: plan.resolved_model } : {}),
        run_in_background: spec.run_in_background === true,
        error_message: "task id allocation failed under contention; retry the spawn",
      }
    }

    const registration = requestedRegistration ?? this.#names.register(spec.parent_session_id, undefined, claimed.task_id)
    let finalRecord: TaskRecord
    let managedSpec: ManagedStartSpec
    try {
      const renamedRecord: TaskRecord = registration.name === claimed.name ? claimed : { ...claimed, name: registration.name }
      managedSpec = buildManagedSpec({
        record: renamedRecord,
        spec,
        plan,
        cwd: this.#options.cwd,
        stateDir: this.#options.store.stateDir,
      })
      // Persist the mode-neutral rebuild spec for BOTH execution modes: v1 carries only safe
      // launch facts (effective prompt, instructions, tool names, cwd) - never executable tools,
      // extensions, or member env.
      finalRecord = { ...renamedRecord, spawn_spec: buildSpawnSpecV1(managedSpec) }
      this.#options.store.replace(finalRecord)
      if (spec.run_in_background === true) this.#background.add(finalRecord.task_id)
    } catch (error) {
      if (registration.name !== claimed.name) this.#names.release(spec.parent_session_id, registration.name)
      this.#background.delete(claimed.task_id)
      const timestamp = nowIso(this.#now)
      const started = this.#options.store.transition(claimed.task_id, { type: "start", timestamp })
      const failed = this.#options.store.transition(claimed.task_id, {
        type: "fail",
        timestamp,
        error_message: "spawn bookkeeping failed",
      })
      if (!started.applied || !failed.applied) throw new Error("spawn bookkeeping failure transitions were not applied")
      return {
        kind: "start_failed",
        task_id: claimed.task_id,
        name: registration.name,
        ...(claimed.category !== undefined ? { category: claimed.category } : {}),
        ...(claimed.agent_type !== undefined ? { subagent_type: claimed.agent_type } : {}),
        execution_mode: executionMode,
        model: claimed.model,
        ...(claimed.resolved_model !== undefined ? { resolved_model: claimed.resolved_model } : {}),
        run_in_background: spec.run_in_background === true,
        error_message: "spawn bookkeeping failed",
      }
    }
    const runner = this.#options.runners[executionMode]
    const context: LaunchContext = { record: finalRecord, managedSpec, runner, model: plan.model }
    const startParts = {
      ...(plan.resolved_model !== undefined ? { resolved_model: plan.resolved_model } : {}),
      ...(registration.warning !== undefined ? { name_warning: registration.warning } : {}),
    }

    if (this.#concurrency.hasFreeSlot(plan.model)) {
      this.#concurrency.acquire(plan.model, finalRecord.task_id)
      const launched = await this.#launch(context)
      if (!launched.ok) {
        return {
          kind: "start_failed",
          task_id: finalRecord.task_id,
          name: registration.name,
          ...(finalRecord.category !== undefined ? { category: finalRecord.category } : {}),
          ...(finalRecord.agent_type !== undefined ? { subagent_type: finalRecord.agent_type } : {}),
          execution_mode: executionMode,
          model: finalRecord.model,
          ...(finalRecord.resolved_model !== undefined ? { resolved_model: finalRecord.resolved_model } : {}),
          run_in_background: spec.run_in_background === true,
          error_message: launched.error,
        }
      }
      return { kind: "started", task_id: finalRecord.task_id, status: "running", name: registration.name, ...startParts }
    }

    const position = this.#concurrency.enqueue(plan.model, finalRecord.task_id, () => {
      void this.#launch(context)
    })
    return {
      kind: "started",
      task_id: finalRecord.task_id,
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
    const subscribers = this.#childSubscribers.get(taskId)
    if (subscribers !== undefined) {
      for (const unsubscribe of subscribers.values()) unsubscribe()
      this.#childSubscribers.delete(taskId)
    }
    this.#background.delete(taskId)
    this.#released.delete(taskId)
    this.#runStats.delete(taskId)
    this.#steering.dropPending(taskId)
  }

  getResidentHandle(taskId: string): ManagedChildHandle | undefined { return this.#live.get(taskId)?.handle }

  subscribeChild(taskId: string, listener: ManagedChildListener): () => void {
    const live = this.getResidentHandle(taskId)
    // Idempotent cleanup: callers (task_output waits) may release twice, and the manager sweeps too.
    if (live !== undefined) return onceOnly(live.subscribe(listener))
    const subscribers = this.#childSubscribers.get(taskId) ?? new Map<ManagedChildListener, () => void>()
    this.#childSubscribers.set(taskId, subscribers)
    // Pending listeners have no handle yet. A placeholder lets cleanup remove them before promotion.
    subscribers.set(listener, () => {
      subscribers.delete(listener)
      if (subscribers.size === 0) this.#childSubscribers.delete(taskId)
    })
    return () => subscribers.get(listener)?.()
  }

  runStatsSnapshot(taskId: string): TaskRunStats | undefined { return this.#runStats.get(taskId)?.snapshot(this.#now()) }

  residentTaskIds(): readonly string[] { return [...this.#live.keys()] }

  promoteToBackground(taskId: string): boolean {
    const promoted = !this.wasBackground(taskId)
    this.#background.add(taskId)
    // Background intent must survive the owning process: a resumed manager reads the RECORD to
    // decide terminal notification, so promotion is persisted, not just held in memory.
    this.#options.store.mutate(taskId, (record) =>
      record.notify_on_terminal ? record : { ...record, notify_on_terminal: true },
    )
    return promoted
  }

  // The record is authoritative (it outlives this process); the in-memory set only answers for
  // tasks whose record is unsaved or unreadable.
  wasBackground(taskId: string): boolean {
    const record = this.#tryLoad(taskId)
    if (record === null) return this.#background.has(taskId)
    return record.notify_on_terminal
  }

  respawn(record: TaskRecord, resumeSessionPath?: string): Promise<RespawnResult> {
    return respawnManagedTask({
      record,
      sessionPath: resumeSessionPath,
      stateDir: this.#options.store.stateDir,
      runners: this.#options.runners,
      rpcRunner: this.#rpcRespawnRunner,
      ...(this.#options.trustedRespawnLaunch === undefined
        ? {}
        : { trustedLaunch: this.#options.trustedRespawnLaunch }),
    })
  }

  reattach(record: TaskRecord, handle: ManagedChildHandle): Promise<ReattachResult> {
    return reattachManagedTask({
      record,
      handle,
      store: this.#options.store,
      hostPid: this.#hostPid,
      now: this.#now,
      isAttached: (taskId) => this.#live.has(taskId),
      attachLive: (fresh, attachedHandle) => {
        const unsubscribe = this.#subscribeChildFacts(attachedHandle, fresh.task_id)
        this.#live.set(fresh.task_id, { handle: attachedHandle, model: fresh.model, unsubscribe })
        this.#attachChildSubscribers(fresh.task_id, attachedHandle)
        return unsubscribe
      },
      detachLive: (taskId, attachedHandle, unsubscribe) => {
        unsubscribe()
        if (this.#live.get(taskId)?.handle === attachedHandle) this.#live.delete(taskId)
      },
      armOutcome: (fresh, attachedHandle, epoch) => {
        this.#concurrency.acquire(fresh.model, fresh.task_id)
        this.#outcome.trackOutcome(fresh.task_id, attachedHandle, fresh.model, epoch)
        void this.#steering.notifyStarted(fresh.task_id)
      },
    })
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

    const unsubscribe = this.#subscribeChildFacts(handle, record.task_id)
    this.#live.set(record.task_id, {
      handle,
      model,
      unsubscribe,
      managedSpec,
      runner,
    })
    this.#attachChildSubscribers(record.task_id, handle)
    this.#recordSpawnFacts(record.task_id, handle)
    this.#outcome.trackOutcome(record.task_id, handle, model, record.notification.run_epoch)
    void this.#steering.notifyStarted(record.task_id)
    return { ok: true }
  }

  // Persist the spawned child's OS pid onto the running record so task_output(status) and session_start
  // reconciliation can see (and, for an orphan, signal) the live process. The pure decision lives in
  // recordSpawnedPid; in-process children (no pid) and already-terminal records are left untouched.
  #attachChildSubscribers(taskId: string, handle: ManagedChildHandle): void {
    const subscribers = this.#childSubscribers.get(taskId)
    if (subscribers === undefined) return
    for (const [listener] of subscribers) {
      const detach = handle.subscribe(listener)
      subscribers.set(listener, onceOnly(() => {
        detach()
        subscribers.delete(listener)
        if (subscribers.size === 0) this.#childSubscribers.delete(taskId)
      }))
    }
  }

  #recordSpawnFacts(taskId: string, handle: ManagedChildHandle): void {
    const current = this.#tryLoad(taskId)
    if (current === null || isTerminalRecord(current)) return
    const withPid = recordSpawnedPid(current, handle.pid) ?? current
    const spawnSpec = handle.spawnSpec
    // A v1 spawn_spec persisted at spawn is authoritative: the rpc echo would rewrite it as the
    // legacy {cwd, extensions, member_env} shape, dropping the rebuild facts v1 carries.
    const updated: TaskRecord = spawnSpec === undefined || (current.spawn_spec !== undefined && isSpawnSpecV1(current.spawn_spec))
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

  // One child subscription feeds BOTH durable facts: the JSONL transcript log and the run-stats
  // tracker whose snapshot lands on the terminal record. Looked up per event so a revive can
  // swap in a fresh tracker without resubscribing.
  #subscribeChildFacts(handle: ManagedChildHandle, taskId: string): () => void {
    const transcript = subscribeTranscriptLog(handle, this.#options.store, taskId)
    this.#runStats.set(taskId, createRunStatsTracker(this.#now(), this.#now))
    const stats = handle.subscribe((event) => {
      this.#runStats.get(taskId)?.accept(event)
    })
    return () => {
      transcript()
      stats()
    }
  }

  async #tryRuntimeFallback(input: {
    readonly taskId: string
    readonly handle: ManagedChildHandle
    readonly model: string
    readonly epoch: number
    readonly outcome: Awaited<ReturnType<ManagedChildHandle["waitForOutcome"]>>
    readonly runStats: TaskRunStats | undefined
    readonly timestamp: string
  }): Promise<boolean> {
    if (
      input.outcome.status !== "error"
      || input.outcome.killed === true
      || (
        input.outcome.failure.kind !== "child-turn-failed"
        && input.outcome.failure.kind !== "child-prompt-failed"
      )
      || (input.runStats?.tool_calls ?? 0) > 0
    ) {
      return false
    }

    const record = this.#tryLoad(input.taskId)
    const nextModel = record?.fallback_models?.[0]
    const live = this.#live.get(input.taskId)
    if (
      record == null
      || nextModel === undefined
      || live?.handle !== input.handle
      || live.managedSpec === undefined
      || live.runner === undefined
    ) {
      return false
    }
    const managedSpec = live.managedSpec
    const runner = live.runner

    await (this.#options.destruction ?? NOOP_DESTRUCTION)
      .destroyResidentTask(input.taskId, "fallback_handoff")

    live.unsubscribe()
    this.#live.delete(input.taskId)
    this.#releaseSlot(input.taskId, input.model, input.epoch)

    const remainingModels = record.fallback_models?.slice(1) ?? []
    const fallbackAttempts = [
      ...(record.fallback_attempts
        ?? (record.resolved_model === undefined ? [] : [record.resolved_model])),
      nextModel,
    ]
    const nextEpoch = record.notification.run_epoch + 1
    const nextRecord: TaskRecord = {
      ...record,
      model: nextModel.display,
      resolved_model: nextModel,
      fallback_models: remainingModels,
      fallback_attempts: fallbackAttempts,
      updated_at: input.timestamp,
      notification: {
        ...record.notification,
        run_epoch: nextEpoch,
      },
    }
    this.#options.store.replace(nextRecord)
    this.#options.store.appendEvent(input.taskId, {
      type: "task_model_fallback",
      payload: {
        from_model: record.model,
        to_model: nextModel.display,
        error_message: input.outcome.failure.message,
      },
    })

    const nextSpec: ManagedStartSpec = {
      ...managedSpec,
      model: nextModel.display,
      requestedModel: record.requested_model,
      fallbackModels: remainingModels,
      ...resolvedReasoningFields(nextModel),
    }
    const launch = (): void => {
      void this.#launchRuntimeFallback({
        record: nextRecord,
        managedSpec: nextSpec,
        runner,
        model: nextModel.display,
      })
    }

    if (this.#concurrency.hasFreeSlot(nextModel.display)) {
      this.#concurrency.acquire(nextModel.display, input.taskId)
      launch()
    } else {
      this.#concurrency.enqueue(nextModel.display, input.taskId, launch)
    }
    return true
  }

  async #launchRuntimeFallback(context: LaunchContext): Promise<void> {
    const current = this.#tryLoad(context.record.task_id)
    if (current?.status !== "running") {
      this.#releaseSlot(
        context.record.task_id,
        context.model,
        context.record.notification.run_epoch,
      )
      this.#settleWaiters(context.record.task_id)
      return
    }

    let handle: ManagedChildHandle
    try {
      handle = await context.runner.start(context.managedSpec)
    } catch (error) {
      const message = publicStartFailureMessage(error)
      this.#releaseSlot(
        context.record.task_id,
        context.model,
        context.record.notification.run_epoch,
      )
      this.#options.store.transition(context.record.task_id, {
        type: "fail",
        timestamp: nowIso(this.#now),
        error_message: message,
      })
      this.#settleWaiters(context.record.task_id)
      return
    }

    const unsubscribe = this.#subscribeChildFacts(handle, context.record.task_id)
    this.#live.set(context.record.task_id, {
      handle,
      model: context.model,
      unsubscribe,
      managedSpec: context.managedSpec,
      runner: context.runner,
    })
    this.#attachChildSubscribers(context.record.task_id, handle)
    this.#recordSpawnFacts(context.record.task_id, handle)
    this.#outcome.trackOutcome(
      context.record.task_id,
      handle,
      context.model,
      context.record.notification.run_epoch,
    )
  }

  // A revived child is running again and SHOULD occupy a slot; re-acquire it and re-arm outcome
  // tracking under the new run_epoch so the eventual second completion releases the slot cleanly.
  #reacquireForRevive(taskId: string): void {
    const live = this.#live.get(taskId)
    if (live === undefined) return
    const record = this.#tryLoad(taskId)
    const epoch = record?.notification.run_epoch ?? 0
    this.#concurrency.acquire(live.model, taskId)
    // A revived run gets a fresh tracker so its eventual terminal stats describe THIS run.
    this.#runStats.set(taskId, createRunStatsTracker(this.#now(), this.#now))
    this.#outcome.trackOutcome(taskId, live.handle, live.model, epoch)
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
