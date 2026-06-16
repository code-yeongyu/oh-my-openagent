import { subagentSessions } from "../claude-code-session-state"
import { registerManagerForCleanup, unregisterManagerForCleanup } from "../background-agent/process-cleanup"
import { log } from "../../shared"
import type { SchedulerDeps, TimerHandle } from "./batcher"
import { MonitorBatcher } from "./batcher"
import { createMonitorFilter } from "./filter"
import {
  DEFAULT_MONITOR_CONFIG,
  createEmptyCounters,
  createMonitorId,
  createRealScheduler,
  type InternalMonitorState,
  type MonitorManagerDeps,
  type MonitorManagerOptions,
} from "./manager-internals"
import { createMonitorInjector, createMonitorState, observeProcessExit, spawnMonitorProcess } from "./monitor-state-factory"
import { MonitorRingBuffer } from "./ring-buffer"
import type {
  MonitorId,
  MonitorManager as MonitorManagerContract,
  MonitorManagerEvent,
  MonitorOutputQuery,
  MonitorOutputResult,
  MonitorRecord,
  MonitorStartOpts,
  MonitorStatus,
} from "./types"

export type { MonitorManagerDeps, MonitorManagerOptions }

export class MonitorManager implements MonitorManagerContract {
  private readonly monitors = new Map<MonitorId, InternalMonitorState>()
  private readonly monitorsByParentSession = new Map<string, Set<MonitorId>>()
  private readonly scheduledFlushTimers = new Map<MonitorId, TimerHandle>()
  private readonly config: typeof DEFAULT_MONITOR_CONFIG
  private readonly scheduler: SchedulerDeps
  private readonly registerCleanup: typeof registerManagerForCleanup
  private readonly unregisterCleanup: typeof unregisterManagerForCleanup
  private readonly logger: typeof log
  private shutdownTriggered = false

  constructor(private readonly options: MonitorManagerOptions) {
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...options.config }
    this.scheduler = options.deps?.scheduler ?? createRealScheduler()
    this.registerCleanup = options.deps?.registerManagerForCleanup ?? registerManagerForCleanup
    this.unregisterCleanup = options.deps?.unregisterManagerForCleanup ?? unregisterManagerForCleanup
    this.logger = options.deps?.log ?? log
    this.registerCleanup(this)
  }

  async start(opts: MonitorStartOpts): Promise<MonitorRecord> {
    if (this.isBackgroundSession(opts.parentSessionId)) {
      throw new Error("monitor_start is only available from a primary session")
    }

    this.assertSessionCapacity(opts.parentSessionId)

    const id = this.createId()
    const filterResult = createMonitorFilter(opts.matchPattern, {
      patternMaxLength: this.config.pattern_max_length,
    })
    if (!filterResult.filter) {
      throw new Error(`monitor_start match_pattern rejected: ${filterResult.error ?? "invalid pattern"}`)
    }

    const monitoredProcess = spawnMonitorProcess(this.options.deps, opts.command, this.config.max_runtime_ms)
    const ring = new MonitorRingBuffer({ ringMaxLines: this.config.ring_max_lines })
    const batcher = new MonitorBatcher({
      batchMaxLines: this.config.batch_max_lines,
      batchMaxBytes: this.config.batch_max_bytes,
      flushIntervalMs: this.config.flush_interval_ms,
      scheduler: this.scheduler,
    })

    const record: MonitorRecord = {
      id,
      command: opts.command,
      label: opts.label ?? id,
      mode: opts.mode ?? "idle",
      parentSessionId: opts.parentSessionId,
      startedAt: new Date(this.scheduler.now()),
      status: "running",
      counters: ring.getCounters(),
    }

    const injector = createMonitorInjector(
      this.options.deps,
      this.options.pluginContext,
      record,
      (monitorId, delayMs, operation) => this.scheduleFlush(monitorId, delayMs, operation),
    )
    const state = createMonitorState({
      record,
      monitoredProcess,
      filter: filterResult.filter,
      ring,
      batcher,
      injector,
      config: this.config,
      logger: this.logger,
    })

    this.addMonitor(state)
    observeProcessExit(state, this.logger, (parentSessionId) => this.enforceTerminalRetention(parentSessionId))
    return { ...record }
  }

  async stop(id: MonitorId): Promise<void> {
    const state = this.monitors.get(id)
    if (!state) {
      return
    }

    if (state.stopped || state.record.status === "stopped") {
      state.record.status = "stopped"
      return
    }

    state.stopped = true
    state.record.status = "stopped"
    this.clearScheduledFlush(id)
    state.batcher.destroy()
    state.pipeline.stop()
    state.process.kill("SIGTERM")
    this.enforceTerminalRetention(state.record.parentSessionId)
  }

  list(sessionId: string): MonitorRecord[] {
    const ids = this.monitorsByParentSession.get(sessionId)
    if (!ids) {
      return []
    }

    return [...ids]
      .map((id) => this.monitors.get(id)?.record)
      .filter((record): record is MonitorRecord => record !== undefined)
      .map((record) => ({ ...record }))
  }

  get(id: MonitorId): MonitorRecord | undefined {
    const record = this.monitors.get(id)?.record
    return record ? { ...record } : undefined
  }

  getOutput(id: MonitorId, opts: MonitorOutputQuery): MonitorOutputResult {
    const state = this.monitors.get(id)
    if (!state) {
      return { lines: [], counters: createEmptyCounters() }
    }

    return state.ring.query({ stream: opts.stream ?? "all", since_sequence: opts.since_sequence, limit: opts.limit })
  }

  async stopSessionMonitors(sessionId: string): Promise<void> {
    const ids = [...this.monitorsByParentSession.get(sessionId) ?? []]
    await Promise.all(ids.map((id) => this.stop(id)))
    for (const id of ids) {
      this.removeMonitor(id)
    }
  }

  handleEvent(event: MonitorManagerEvent): void {
    if (event.type === "session.idle") {
      this.flushSessionMonitors(event.sessionId)
      return
    }

    if (event.type === "session.deleted") {
      void this.stopSessionMonitors(event.sessionId).catch((error) => {
        this.logger("[monitor] Failed to stop monitors for deleted session", { sessionId: event.sessionId, error })
      })
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownTriggered) {
      return
    }
    this.shutdownTriggered = true

    for (const id of [...this.scheduledFlushTimers.keys()]) {
      this.clearScheduledFlush(id)
    }

    const states = [...this.monitors.values()]
    await Promise.all(states.map((state) => this.stop(state.record.id)))
    this.monitors.clear()
    this.monitorsByParentSession.clear()
    this.unregisterCleanup(this)
  }

  private createId(): MonitorId {
    return this.options.deps?.randomId?.() ?? createMonitorId()
  }

  private scheduleFlush(monitorId: string, delayMs: number, operation: () => Promise<void>): void {
    this.clearScheduledFlush(monitorId)
    const timer = this.scheduler.setTimer(() => {
      this.scheduledFlushTimers.delete(monitorId)
      void operation().catch((error) => {
        this.logger("[monitor] Failed to flush monitor output", { monitorId, error })
      })
    }, delayMs)
    this.scheduledFlushTimers.set(monitorId, timer)
  }

  private clearScheduledFlush(monitorId: string): void {
    const timer = this.scheduledFlushTimers.get(monitorId)
    if (!timer) {
      return
    }

    this.scheduler.clearTimer(timer)
    this.scheduledFlushTimers.delete(monitorId)
  }

  private addMonitor(state: InternalMonitorState): void {
    this.monitors.set(state.record.id, state)
    const ids = this.monitorsByParentSession.get(state.record.parentSessionId) ?? new Set<MonitorId>()
    ids.add(state.record.id)
    this.monitorsByParentSession.set(state.record.parentSessionId, ids)
  }

  private assertSessionCapacity(sessionId: string): void {
    const activeCount = [...this.monitorsByParentSession.get(sessionId) ?? []]
      .map((id) => this.monitors.get(id)?.record.status)
      .filter((status) => status === "starting" || status === "running").length

    if (activeCount >= this.config.max_monitors_per_session) {
      throw new Error(`max_monitors_per_session reached for session ${sessionId}`)
    }
  }

  private isBackgroundSession(sessionId: string): boolean {
    if (this.options.deps?.isBackgroundSession?.(sessionId)) {
      return true
    }

    return subagentSessions.has(sessionId)
  }

  private isTerminalStatus(status: MonitorStatus): boolean {
    return status === "stopped" || status === "exited" || status === "failed"
  }

  private removeMonitor(id: MonitorId): void {
    this.clearScheduledFlush(id)
    const state = this.monitors.get(id)
    this.monitors.delete(id)
    if (!state) {
      return
    }
    const ids = this.monitorsByParentSession.get(state.record.parentSessionId)
    if (!ids) {
      return
    }
    ids.delete(id)
    if (ids.size === 0) {
      this.monitorsByParentSession.delete(state.record.parentSessionId)
    }
  }

  private enforceTerminalRetention(sessionId: string): void {
    const ids = this.monitorsByParentSession.get(sessionId)
    if (!ids) {
      return
    }
    const terminalIds: MonitorId[] = []
    for (const [id, state] of this.monitors) {
      if (ids.has(id) && this.isTerminalStatus(state.record.status)) {
        terminalIds.push(id)
      }
    }
    while (terminalIds.length > this.config.max_monitors_per_session) {
      const oldest = terminalIds.shift()
      if (oldest) {
        this.removeMonitor(oldest)
      }
    }
  }

  private flushSessionMonitors(sessionId: string): void {
    const ids = [...this.monitorsByParentSession.get(sessionId) ?? []]
    for (const id of ids) {
      const state = this.monitors.get(id)
      if (!state || state.record.status === "stopped") {
        continue
      }

      void state.injector.flushMonitor(id).catch((error) => {
        this.logger("[monitor] Failed to flush monitor output on session idle", { sessionId, monitorId: id, error })
      })
    }
  }
}

export function createMonitorManager(options: MonitorManagerOptions): MonitorManager {
  return new MonitorManager(options)
}
