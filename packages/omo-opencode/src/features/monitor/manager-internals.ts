import type { PluginInput } from "@opencode-ai/plugin"

import type { MonitorConfig } from "../../config/schema/monitor"
import { registerManagerForCleanup, unregisterManagerForCleanup } from "../background-agent/process-cleanup"
import { log } from "../../shared"
import type { InternalPromptDispatchArgs, PromptAsyncInput, PromptDispatchClient } from "../../shared/prompt-async-gate/types"
import { MonitorBatcher, type SchedulerDeps, type TimerHandle } from "./batcher"
import { createMonitorPipeline } from "./pipeline"
import { spawnMonitoredProcess, type MonitoredProcess } from "./process"
import { MonitorRingBuffer } from "./ring-buffer"
import type { MonitorId, MonitorRecord, OutputBatch } from "./types"

export type MonitorPipeline = ReturnType<typeof createMonitorPipeline>
export type MonitorPromptClient = PromptDispatchClient & InternalPromptDispatchArgs<PromptAsyncInput>["client"]

export interface MonitorInjector {
  queueBatch(record: MonitorRecord, batch: OutputBatch): void
  flushMonitor(monitorId: string): Promise<void>
}

export interface InternalMonitorState {
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

export const DEFAULT_MONITOR_CONFIG = {
  max_monitors_per_session: 3,
  max_runtime_ms: 1800000,
  batch_max_lines: 50,
  batch_max_bytes: 16384,
  flush_interval_ms: 1000,
  ring_max_lines: 1000,
  line_max_bytes: 8192,
  pattern_max_length: 512,
}

export const MONITOR_OUTPUT_PENDING_RETRY_MS = 1_000
export const MONITOR_OUTPUT_ACCEPTED_MESSAGE_SKEW_MS = 5_000
export const MONITOR_OUTPUT_USER_MESSAGE_IN_PROGRESS_WINDOW_MS = 2_000
export const MONITOR_OUTPUT_POST_DISPATCH_HOLD_MS = 250

export function createEmptyCounters() {
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

export function createRealScheduler(): SchedulerDeps {
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

export function createMonitorId(): MonitorId {
  return `mon_${crypto.randomUUID().slice(0, 8)}`
}
