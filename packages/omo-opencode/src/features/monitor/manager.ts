import type { PluginInput } from "@opencode-ai/plugin"

import type { MonitorConfig } from "../../config/schema/monitor"
import { subagentSessions } from "../claude-code-session-state"
import { registerManagerForCleanup, unregisterManagerForCleanup } from "../background-agent/process-cleanup"
import { log } from "../../shared"
import type { InternalPromptDispatchArgs, PromptAsyncInput, PromptDispatchClient } from "../../shared/prompt-async-gate/types"
import { MonitorBatcher, type SchedulerDeps, type TimerHandle } from "./batcher"
import { createMonitorFilter } from "./filter"
import { LineStream } from "./line-stream"
import { MonitorOutputInjector } from "./output-injector"
import { createMonitorPipeline } from "./pipeline"
import { spawnMonitoredProcess, type MonitoredProcess } from "./process"
import { MonitorRingBuffer } from "./ring-buffer"
import type {
  MonitorId,
  MonitorManager as MonitorManagerContract,
  MonitorManagerEvent,
  MonitorOutputQuery,
  MonitorOutputResult,
  MonitorRecord,
  MonitorStartOpts,
  OutputBatch,
} from "./types"

type MonitorPipeline = ReturnType<typeof createMonitorPipeline>
type MonitorPromptClient = PromptDispatchClient & InternalPromptDispatchArgs<PromptAsyncInput>["client"]

interface MonitorInjector {
  queueBatch(record: MonitorRecord, batch: OutputBatch): void
  flushMonitor(monitorId: string): Promise<void>
  requeueMonitor?(monitorId: string): void
}

interface InternalMonitorState {
  record: MonitorRecord
  process: MonitoredProcess
  ring: MonitorRingBuffer
  batcher: MonitorBatcher
  pipeline: MonitorPipeline
  injector: MonitorInjector
  stopped: boolean
}

export interface MonitorManagerDeps {
  randomId?: () => MonitorId
  isBackgroundSession?: (sessionId: string) => boolean
  spawnMonitoredProcess?: typeof spawnMonitoredProcess
  createInjector?: (record: MonitorRecord, scheduleFlush: (monitorId: string, delayMs: number, operation: () => Promise<void>) => void) => MonitorInjector
  scheduler?: SchedulerDeps
  registerManagerForCleanup?: typeof registerManagerForCleanup
  unregisterManagerForCleanup?: typeof unregisterManagerForCleanup
  log?: typeof log
}

export interface MonitorManagerOptions {
  pluginContext: Pick<PluginInput, "client" | "directory">
  config?: Partial<MonitorConfig>
  deps?: MonitorManagerDeps
}

const DEFAULT_MONITOR_CONFIG = {
  max_monitors_per_session: 3,
  max_runtime_ms: 1800000,
  batch_max_lines: 50,
  batch_max_bytes: 16384,
  flush_interval_ms: 1000,
  ring_max_lines: 1000,
  line_max_bytes: 8192,
  pattern_max_length: 512,
}

const MONITOR_OUTPUT_PENDING_RETRY_MS = 1_000
const MONITOR_OUTPUT_ACCEPTED_MESSAGE_SKEW_MS = 5_000
const MONITOR_OUTPUT_USER_MESSAGE_IN_PROGRESS_WINDOW_MS = 2_000
const MONITOR_OUTPUT_PARENT_ACTIVITY_WINDOW_MS = 2_000
const MONITOR_OUTPUT_POST_DISPATCH_HOLD_MS = 250

function createEmptyCounters() {
  return {
    totalLines: 0,
    matchedLines: 0,
    unmatchedLines: 0,
    droppedMatched: 0,
    droppedUnmatched: 0,
    bytesDropped: 0,
    lastSequence: 0,
  }
}

function createRealScheduler(): SchedulerDeps {
  return {
    setTimer(fn: () => void, delayMs: number): TimerHandle {
      const timer = setTimeout(fn, delayMs)
      timer.unref?.()
      return timer
    },
    clearTimer(handle: TimerHandle): void {
      clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    now(): number {
      return Date.now()
    },
  }
}

function createMonitorId(): MonitorId {
  return `mon_${crypto.randomUUID().slice(0, 8)}`
}

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

    const monitoredProcess = this.spawnProcess(opts.command)
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

    const injector = this.createInjector(record)
    const pipeline = createMonitorPipeline(
      {
        lineStream: {
          stdout: new LineStream({ lineMaxBytes: this.config.line_max_bytes }),
          stderr: new LineStream({ lineMaxBytes: this.config.line_max_bytes }),
        },
        filter: filterResult.filter,
        ring,
        batcher,
      },
      {
        stdout: monitoredProcess.stdout,
        stderr: monitoredProcess.stderr,
        log: (error) => this.logger("[monitor] pipeline error", error),
      },
    )

    const state: InternalMonitorState = {
      record,
      process: monitoredProcess,
      ring,
      batcher,
      pipeline,
      injector,
      stopped: false,
    }

    pipeline.onBatch((batch) => {
      if (state.stopped || state.record.status === "stopped") {
        return
      }

      const outputBatch: OutputBatch = {
        ...batch,
        monitorId: state.record.id,
        stillRunning: state.record.status === "running" || state.record.status === "starting",
      }
      state.record.counters = state.ring.getCounters()
      state.injector.queueBatch(state.record, outputBatch)
    })

    this.addMonitor(state)
    this.observeProcessExit(state)
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
  }

  handleEvent(event: MonitorManagerEvent): void {
    if (event.type === "session.idle") {
      this.flushSessionMonitors(event.sessionId)
      return
    }

    if (event.type === "session.error") {
      this.requeueSessionMonitors(event.sessionId)
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

  private spawnProcess(command: string): MonitoredProcess {
    const spawn = this.options.deps?.spawnMonitoredProcess ?? spawnMonitoredProcess
    return spawn({ command, maxRuntimeMs: this.config.max_runtime_ms }, {
      setTimer(fn, ms) {
        const timer = setTimeout(fn, ms)
        timer.unref?.()
        return timer
      },
      clearTimer(handle) {
        clearTimeout(handle)
      },
    })
  }

  private createInjector(record: MonitorRecord): MonitorInjector {
    const scheduleFlush = (monitorId: string, delayMs: number, operation: () => Promise<void>): void => {
      this.scheduleFlush(monitorId, delayMs, operation)
    }
    if (this.options.deps?.createInjector) {
      return this.options.deps.createInjector(record, scheduleFlush)
    }

    return new MonitorOutputInjector({
      client: this.options.pluginContext.client as unknown as MonitorPromptClient,
      directory: this.options.pluginContext.directory,
      pendingRetryMs: MONITOR_OUTPUT_PENDING_RETRY_MS,
      acceptedMessageSkewMs: MONITOR_OUTPUT_ACCEPTED_MESSAGE_SKEW_MS,
      userMessageInProgressWindowMs: MONITOR_OUTPUT_USER_MESSAGE_IN_PROGRESS_WINDOW_MS,
      parentSessionActivityInProgressWindowMs: MONITOR_OUTPUT_PARENT_ACTIVITY_WINDOW_MS,
      postDispatchHoldMs: MONITOR_OUTPUT_POST_DISPATCH_HOLD_MS,
      scheduleFlush,
    })
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

  private observeProcessExit(state: InternalMonitorState): void {
    void state.process.exited.then((result) => {
      if (state.record.status === "stopped") {
        return
      }

      state.record.status = "exited"
      if (result.code !== null) {
        state.record.exitCode = result.code
      }
      if (result.signal !== null) {
        state.record.signal = result.signal
      }
      state.record.counters = state.ring.getCounters()
      state.batcher.flushNow()
      state.batcher.destroy()
      state.pipeline.stop()
      void state.injector.flushMonitor(state.record.id).catch((flushError) => {
        this.logger("[monitor] Failed to flush monitor output after process exit", {
          monitorId: state.record.id,
          error: flushError,
        })
      })
    }).catch((error) => {
      if (state.record.status === "stopped") {
        return
      }

      state.record.status = "failed"
      state.batcher.flushNow()
      state.batcher.destroy()
      state.pipeline.stop()
      void state.injector.flushMonitor(state.record.id).catch((flushError) => {
        this.logger("[monitor] Failed to flush monitor output after process failure", {
          monitorId: state.record.id,
          error: flushError,
        })
      })
      this.logger("[monitor] monitored process failed", { monitorId: state.record.id, error })
    })
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

  private requeueSessionMonitors(sessionId: string): void {
    const ids = [...this.monitorsByParentSession.get(sessionId) ?? []]
    for (const id of ids) {
      const state = this.monitors.get(id)
      if (!state || state.record.status === "stopped") {
        continue
      }

      state.injector.requeueMonitor?.(id)
    }
  }
}

export function createMonitorManager(options: MonitorManagerOptions): MonitorManager {
  return new MonitorManager(options)
}
