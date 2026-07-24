import { join } from "node:path"
import { log } from "@oh-my-opencode/utils"

import { registerLifecycleReattachPorts, type ReattachResult, type RespawnResult } from "../lifecycle/port"
import { RunnerError } from "../runners/in-process/runner-error"
import { RpcProcessRunner } from "../runners/rpc-process"
import { isProcessPid } from "../state/pid"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { createTaskRecord, parseTaskId, syncTaskIdFloor } from "../state"
import { TaskIdSpaceExhaustedError } from "../state/id"
import type { TaskRecord } from "../state"
import { createSteeringEngine } from "../steering"
import type { CancelOutcome, DestructionPort, InterruptInput, InterruptOutcome, SendInput, SendOutcome, SteeringEngine, SteeringPort } from "../steering"
import { adaptRpcHandle, discardManagedHandle, discardRpcHandle, type ManagedChildHandle, type ManagedChildListener } from "./child-handle"
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
import { claimTaskRecord, TaskRecordCollisionError } from "../store"
import { NameRegistry } from "./names"
import { subscribeTranscriptLog } from "./transcript-log"
import { buildTaskLineageEnv } from "./lineage-env"
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
  respawn(record: TaskRecord, currentSessionId: string, resumeSessionPath: string): Promise<RespawnResult>
  reattach(record: TaskRecord, handle: ManagedChildHandle): Promise<ReattachResult>
  waiterKeyCount(): number
  releasedKeyCount(): number
}

const NOOP_DESTRUCTION: DestructionPort = { destroyResidentTask: () => Promise.resolve() }
const GENERIC_START_FAILURE_MESSAGE = "Task runner failed to start."
const RESPAWN_CLEANUP_FAILURE_REASON = "rpc respawn cleanup failed"

function spawnDenialMessage(decision: Extract<ReturnType<typeof decideDepthPolicy>, { readonly allowed: false }>): string {
  if (decision.reason === "invalid_policy") return `Invalid spawn policy field: ${decision.invalidField}.`
  return `Spawn denied: ${decision.reason}.`
}

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
      now: this.#now,
    }
    this.#steering = createSteeringEngine(port)
    registerLifecycleReattachPorts(options.store, {
      respawn: (record, currentSessionId, resumeSessionPath) => this.respawn(record, currentSessionId, resumeSessionPath),
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

    const maxDepth = this.#options.config.max_depth
    const targetAgentType = plan.agentType ?? plan.category ?? spec.subagent_type ?? spec.category ?? plan.model
    const decision = decideDepthPolicy({
      childDepth: spec.depth,
      maxDepth,
      targetAgentType,
      callerRole: spec.caller_role ?? "leaf",
      lineage: spec.lineage ?? "unknown",
      ...(spec.caller_max_depth !== undefined ? { callerMaxDepth: spec.caller_max_depth } : {}),
      ...(spec.allowed_subagents !== undefined ? { allowedSubagents: spec.allowed_subagents } : {}),
    })
    if (!decision.allowed) {
      return {
        kind: "depth_denied",
        reason: spawnDenialMessage(decision),
        child_depth: spec.depth,
        max_depth: "effectiveMaxDepth" in decision ? decision.effectiveMaxDepth : maxDepth,
        denial: decision,
      }
    }

    if (this.#options.admit !== undefined) {
      const admission = await this.#options.admit(spec.parent_session_id)
      if (admission.kind === "rejected") return { kind: "residency_denied", reason: admission.message }
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
        ...(plan.category ?? spec.category !== undefined ? { category: plan.category ?? spec.category } : {}),
        ...(plan.agentType ?? spec.subagent_type !== undefined ? { subagent_type: plan.agentType ?? spec.subagent_type } : {}),
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
      finalRecord = renamedRecord
      if (finalRecord !== claimed) this.#options.store.replace(finalRecord)
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
    callerSessionId: string | undefined,
    deliverAs: "steer" | "followUp" = "followUp",
  ): Promise<ContinueResult> {
    const outcome = await this.#steering.sendToTask({ idOrName: taskIdOrName, message: prompt, deliverAs, callerSessionId })
    return toContinueResult(outcome)
  }

  sendToTask(input: SendInput): Promise<SendOutcome> {
    return this.#steering.sendToTask(input)
  }

  async interruptTask(input: InterruptInput): Promise<InterruptOutcome> {
    const outcome = await this.#steering.interruptTask(input)
    if (outcome.kind === "interrupted") this.#releaseSlotForTask(outcome.task_id)
    return outcome
  }

  async cancelTask(idOrName: string, reason?: string, callerSessionId?: string): Promise<CancelOutcome> {
    const outcome = await this.#steering.cancelTask({ idOrName, reason, callerSessionId })
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
    this.#steering.dropPending(taskId)
  }

  getResidentHandle(taskId: string): ManagedChildHandle | undefined { return this.#live.get(taskId)?.handle }

  subscribeChild(taskId: string, listener: ManagedChildListener): () => void {
    const live = this.getResidentHandle(taskId)
    if (live !== undefined) return live.subscribe(listener)
    const subscribers = this.#childSubscribers.get(taskId) ?? new Map<ManagedChildListener, () => void>()
    this.#childSubscribers.set(taskId, subscribers)
    // Pending listeners have no handle yet. A placeholder lets cleanup remove them before promotion.
    subscribers.set(listener, () => {
      subscribers.delete(listener)
      if (subscribers.size === 0) this.#childSubscribers.delete(taskId)
    })
    return () => subscribers.get(listener)?.()
  }

  residentTaskIds(): readonly string[] { return [...this.#live.keys()] }

  wasBackground(taskId: string): boolean { return this.#background.has(taskId) }

  async respawn(record: TaskRecord, currentSessionId: string, resumeSessionPath: string): Promise<RespawnResult> {
    if (record.parent_session_id !== currentSessionId) return { ok: false, reason: "persisted record belongs to another session" }
    if (record.agent_type === undefined && record.category === undefined) {
      return { ok: false, reason: "current spawn target unavailable" }
    }
    const respawnAdmission = this.#options.trustedRespawnAdmission === undefined
      ? undefined
      : await this.#options.trustedRespawnAdmission(record, currentSessionId)
    if (respawnAdmission === undefined) return { ok: false, reason: "current spawn policy unavailable" }
    const currentTarget = this.#options.planner({
      prompt: "",
      parent_session_id: currentSessionId,
      root_session_id: respawnAdmission.rootSessionId,
      depth: respawnAdmission.childDepth,
      ...(record.agent_type !== undefined
        ? { subagent_type: record.agent_type }
        : record.category !== undefined
          ? { category: record.category }
          : {}),
    })
    if (
      currentTarget.kind === "error"
      || (record.agent_type !== undefined && currentTarget.plan.agentType !== record.agent_type)
      || (record.category !== undefined && currentTarget.plan.category !== record.category)
    ) return { ok: false, reason: "current spawn target unavailable" }
    const decision = decideDepthPolicy({
      childDepth: respawnAdmission.childDepth,
      maxDepth: this.#options.config.max_depth,
      targetAgentType: currentTarget.plan.agentType ?? currentTarget.plan.category ?? currentTarget.plan.model,
      callerRole: respawnAdmission.callerRole,
      lineage: respawnAdmission.lineage,
      ...(respawnAdmission.callerMaxDepth !== undefined ? { callerMaxDepth: respawnAdmission.callerMaxDepth } : {}),
      ...(respawnAdmission.allowedSubagents !== undefined ? { allowedSubagents: respawnAdmission.allowedSubagents } : {}),
    })
    if (!decision.allowed) return { ok: false, reason: spawnDenialMessage(decision) }

    let handle: RpcChildHandle | undefined
    let stagedPid: number | undefined
    try {
      const trustedLaunch = this.#options.trustedRespawnLaunch === undefined
        ? undefined
        : await this.#options.trustedRespawnLaunch(record)
      handle = this.#rpcRespawnRunner.start({
        task_id: record.task_id,
        cwd: trustedLaunch?.cwd ?? this.#options.cwd,
        state_dir: join(this.#options.store.stateDir, "children", record.task_id),
        prompt: "",
        resumeSessionPath,
        model: currentTarget.plan.model,
        ...(currentTarget.plan.variant === undefined ? {} : { variant: currentTarget.plan.variant }),
        ...(trustedLaunch?.extensions === undefined ? {} : { extensions: trustedLaunch.extensions }),
        memberEnv: buildTaskLineageEnv(record, trustedLaunch?.memberEnv),
      })
      const pidFacts = processFacts(handle.pid)
      if (pidFacts.pid !== undefined && pidFacts.pid !== record.pid) {
        this.#options.store.replace({ ...(this.#tryLoad(record.task_id) ?? record), ...pidFacts })
        stagedPid = pidFacts.pid
      }
      const switchSession = handle.switchSession
      if (switchSession === undefined) {
        if (!(await this.#disposeFailedRespawn(handle))) return { ok: false, reason: RESPAWN_CLEANUP_FAILURE_REASON }
        this.#restoreRespawnPid(record, stagedPid)
        return { ok: false, reason: "respawned RPC handle cannot switch sessions" }
      }
      const switched = await switchSession(resumeSessionPath)
      if (switched.cancelled) {
        if (!(await this.#disposeFailedRespawn(handle))) return { ok: false, reason: RESPAWN_CLEANUP_FAILURE_REASON }
        this.#restoreRespawnPid(record, stagedPid)
        return { ok: false, reason: "switch_session was cancelled" }
      }
      const { resolved_model: _staleResolvedModel, ...currentRecord } = this.#tryLoad(record.task_id) ?? record
      this.#options.store.replace({
        ...currentRecord,
        model: currentTarget.plan.model,
        ...(currentTarget.plan.resolved_model === undefined ? {} : { resolved_model: currentTarget.plan.resolved_model }),
        updated_at: nowIso(this.#now),
      })
      return { ok: true, handle: adaptRpcHandle(handle) }
    } catch (error) { // no-excuse-ok: catch - RPC respawn boundary converts failures into a typed result.
      const cleanedUp = handle === undefined || await this.#disposeFailedRespawn(handle)
      if (cleanedUp) this.#restoreRespawnPid(record, stagedPid)
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
    let acquiredModel: string | undefined
    try {
      const currentRecord = this.#tryLoad(record.task_id) ?? record
      const pidFacts = processFacts(handle.pid)
      unsubscribe = subscribeTranscriptLog(handle, this.#options.store, record.task_id)
      this.#live.set(record.task_id, { handle, model: currentRecord.model, unsubscribe })
      this.#attachChildSubscribers(record.task_id, handle)
      if (isTerminalRecord(currentRecord) && currentRecord.status !== "lost") {
        this.#options.store.replace({
          ...currentRecord,
          residency_state: "resident",
          host_pid: this.#hostPid,
          updated_at: nowIso(this.#now),
          ...pidFacts,
        })
        return { ok: true }
      }

      const { error_message: _error, final_response: _final, killed: _killed, ...rest } = currentRecord
      const reattached: TaskRecord = {
        ...rest,
        status: "running",
        residency_state: "resident",
        host_pid: this.#hostPid,
        updated_at: nowIso(this.#now),
        notification: { ...currentRecord.notification, run_epoch: currentRecord.notification.run_epoch + 1 },
        ...pidFacts,
      }
      this.#options.store.replace(reattached)
      acquiredEpoch = reattached.notification.run_epoch
      acquiredModel = currentRecord.model
      this.#concurrency.acquire(currentRecord.model, record.task_id)
      this.#trackOutcome(record.task_id, handle, currentRecord.model, acquiredEpoch)
      return { ok: true }
    } catch (error) { // no-excuse-ok: catch - ownership-transfer boundary converts setup failure into a typed result.
      unsubscribe?.()
      if (this.#live.get(record.task_id)?.handle === handle) this.#live.delete(record.task_id)
      if (acquiredEpoch !== undefined && acquiredModel !== undefined) this.#releaseSlot(record.task_id, acquiredModel, acquiredEpoch)
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

  #restoreRespawnPid(record: TaskRecord, stagedPid: number | undefined): void {
    if (stagedPid === undefined) return
    const current = this.#tryLoad(record.task_id)
    if (current?.pid !== stagedPid) return
    const livePid = processFacts(this.#live.get(record.task_id)?.handle.pid).pid
    if (livePid !== undefined) {
      this.#options.store.replace({ ...current, pid: livePid })
      return
    }
    if (record.pid === undefined) {
      const { pid: _pid, ...restored } = current
      this.#options.store.replace(restored)
      return
    }
    this.#options.store.replace({ ...current, pid: record.pid })
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
    this.#attachChildSubscribers(record.task_id, handle)
    this.#recordSpawnFacts(record.task_id, handle)
    this.#trackOutcome(record.task_id, handle, model, record.notification.run_epoch)
    void this.#steering.notifyStarted(record.task_id)
    return { ok: true }
  }

  // Persist only the spawned child's OS pid so reconciliation can identify a live process. Launch
  // inputs remain runtime-only and are rebuilt from current configuration during respawn.
  #attachChildSubscribers(taskId: string, handle: ManagedChildHandle): void {
    const subscribers = this.#childSubscribers.get(taskId)
    if (subscribers === undefined) return
    for (const [listener] of subscribers) {
      subscribers.set(listener, handle.subscribe(listener))
    }
  }

  #recordSpawnFacts(taskId: string, handle: ManagedChildHandle): void {
    const current = this.#tryLoad(taskId)
    if (current === null || isTerminalRecord(current)) return
    const withPid = recordSpawnedPid(current, handle.pid) ?? current
    if (withPid !== current) this.#options.store.replace(withPid)
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

function processFacts(pid: number | undefined): Partial<Pick<TaskRecord, "pid">> {
  if (pid === undefined || !isProcessPid(pid)) return {}
  return { pid }
}

export function createTaskManager(options: TaskManagerImplOptions): ReattachingTaskManager {
  return new TaskManagerImpl(options)
}
