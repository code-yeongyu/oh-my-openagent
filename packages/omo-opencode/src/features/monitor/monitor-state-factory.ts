import type { PluginInput } from "@opencode-ai/plugin"

import { log } from "../../shared"
import type { MonitorBatcher } from "./batcher"
import { LineStream } from "./line-stream"
import type {
  DEFAULT_MONITOR_CONFIG,
  InternalMonitorState,
  MonitorInjector,
  MonitorManagerDeps,
  MonitorPromptClient,
} from "./manager-internals"
import {
  MONITOR_OUTPUT_ACCEPTED_MESSAGE_SKEW_MS,
  MONITOR_OUTPUT_MAX_ACTIVE_DEFER_MS,
  MONITOR_OUTPUT_PENDING_RETRY_MS,
  MONITOR_OUTPUT_POST_DISPATCH_HOLD_MS,
  MONITOR_OUTPUT_USER_MESSAGE_IN_PROGRESS_WINDOW_MS,
} from "./manager-internals"
import { MonitorOutputInjector } from "./output-injector"
import { createMonitorPipeline } from "./pipeline"
import { spawnMonitoredProcess, type MonitoredProcess } from "./process"
import { MonitorRingBuffer } from "./ring-buffer"
import { MonitorRateLimiter } from "./rate-limiter"
import type { MonitorOutputFile } from "./output-file"
import type { MonitorRecord, OutputBatch } from "./types"

interface MonitorStateFactoryInput {
  record: MonitorRecord
  monitoredProcess: MonitoredProcess
  filter: { matches(text: string): boolean }
  ring: MonitorRingBuffer
  batcher: MonitorBatcher
  injector: MonitorInjector
  config: typeof DEFAULT_MONITOR_CONFIG
  logger: typeof log
  now: () => number
  outputFile?: MonitorOutputFile
}

export function createMonitorState(input: MonitorStateFactoryInput): InternalMonitorState {
  const { record, monitoredProcess, filter, ring, batcher, injector, config, logger, now, outputFile } = input

  const pipeline = createMonitorPipeline(
    {
      lineStream: {
        stdout: new LineStream({ lineMaxBytes: config.line_max_bytes }),
        stderr: new LineStream({ lineMaxBytes: config.line_max_bytes }),
      },
      filter,
      ring,
      batcher,
      ...(outputFile ? { sink: outputFile } : {}),
    },
    {
      stdout: monitoredProcess.stdout,
      stderr: monitoredProcess.stderr,
      log: (error) => logger("[monitor] pipeline error", error),
    },
  )

  const state: InternalMonitorState = {
    record,
    process: monitoredProcess,
    ring,
    batcher,
    pipeline,
    injector,
    rateLimiter: new MonitorRateLimiter(now),
    suppressedEvents: 0,
    stopped: false,
  }

  pipeline.onBatch((batch) => {
    if (state.stopped || state.record.status === "stopped") {
      return
    }

    const stillRunning = state.record.status === "running" || state.record.status === "starting"
    // The end of a watch is always reported; a running monitor that prints too fast loses batches to the rate limit.
    if (stillRunning && !state.rateLimiter.tryTake()) {
      state.suppressedEvents += batch.lines.length
      return
    }
    const outputBatch: OutputBatch = {
      ...batch,
      monitorId: state.record.id,
      stillRunning,
      ...(state.suppressedEvents > 0 ? { suppressedEvents: state.suppressedEvents } : {}),
    }
    state.suppressedEvents = 0
    state.record.eventsDelivered += batch.lines.length
    state.record.counters = state.ring.getCounters()
    state.injector.queueBatch(state.record, outputBatch)
  })

  return state
}

export function observeProcessExit(
  state: InternalMonitorState,
  logger: typeof log,
  onTerminal: (parentSessionId: string) => void,
): void {
  void state.process.exited
    .then((result) => {
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
      state.batcher.flushNow({ allowEmpty: true })
      state.batcher.destroy()
      state.pipeline.stop()
      void state.injector.flushMonitor(state.record.id).catch((flushError) => {
        logger("[monitor] Failed to flush monitor output after process exit", {
          monitorId: state.record.id,
          error: flushError,
        })
      })
      onTerminal(state.record.parentSessionId)
    })
    .catch((error) => {
      if (state.record.status === "stopped") {
        return
      }

      state.record.status = "failed"
      state.batcher.flushNow({ allowEmpty: true })
      state.batcher.destroy()
      state.pipeline.stop()
      void state.injector.flushMonitor(state.record.id).catch((flushError) => {
        logger("[monitor] Failed to flush monitor output after process failure", {
          monitorId: state.record.id,
          error: flushError,
        })
      })
      logger("[monitor] monitored process failed", { monitorId: state.record.id, error })
      onTerminal(state.record.parentSessionId)
    })
}

export function spawnMonitorProcess(
  deps: MonitorManagerDeps | undefined,
  command: string,
  maxRuntimeMs: number,
): MonitoredProcess {
  const spawn = deps?.spawnMonitoredProcess ?? spawnMonitoredProcess
  return spawn(
    { command, maxRuntimeMs },
    {
      setTimer(fn, ms) {
        const timer = setTimeout(fn, ms)
        timer.unref?.()
        return timer
      },
      clearTimer(handle) {
        clearTimeout(handle)
      },
    },
  )
}

export function createMonitorInjector(
  deps: MonitorManagerDeps | undefined,
  pluginContext: Pick<PluginInput, "client" | "directory">,
  record: MonitorRecord,
  scheduleFlush: (monitorId: string, delayMs: number, operation: () => Promise<void>) => void,
): MonitorInjector {
  if (deps?.createInjector) {
    return deps.createInjector(record, scheduleFlush)
  }

  return new MonitorOutputInjector({
    client: pluginContext.client as unknown as MonitorPromptClient,
    directory: pluginContext.directory,
    pendingRetryMs: MONITOR_OUTPUT_PENDING_RETRY_MS,
    acceptedMessageSkewMs: MONITOR_OUTPUT_ACCEPTED_MESSAGE_SKEW_MS,
    userMessageInProgressWindowMs: MONITOR_OUTPUT_USER_MESSAGE_IN_PROGRESS_WINDOW_MS,
    postDispatchHoldMs: MONITOR_OUTPUT_POST_DISPATCH_HOLD_MS,
    maxActiveDeferMs: MONITOR_OUTPUT_MAX_ACTIVE_DEFER_MS,
    scheduleFlush,
  })
}
