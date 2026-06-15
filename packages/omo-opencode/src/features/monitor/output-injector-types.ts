import type { InternalPromptDispatchArgs, InternalPromptDispatchResult, PromptAsyncInput, PromptDispatchClient } from "../../shared/prompt-async-gate/types"
import type { MonitorRecord, OutputBatch } from "./types"

export type MonitorPromptClient = PromptDispatchClient & InternalPromptDispatchArgs<PromptAsyncInput>["client"]

export type MonitorOutputInjectorDeps = {
  readonly client: MonitorPromptClient
  readonly directory: string
  readonly pendingRetryMs: number
  readonly acceptedMessageSkewMs: number
  readonly userMessageInProgressWindowMs: number
  readonly postDispatchHoldMs: number
  readonly dispatchInternalPrompt?: (args: InternalPromptDispatchArgs<PromptAsyncInput>) => Promise<InternalPromptDispatchResult>
  readonly now?: () => number
  readonly settleAfterSessionIdle?: () => Promise<void>
  readonly scheduleFlush?: (monitorId: string, delayMs: number, operation: () => Promise<void>) => void
}

export type MonitorSessionMessage = {
  info?: {
    role?: string
    finish?: string
    time?: { created?: unknown }
  }
  role?: string
  finish?: string
  time?: { created?: unknown }
  parts?: Array<{
    type?: string
    text?: string
    synthetic?: boolean
    content?: unknown
    state?: { status?: unknown }
  }>
}

export type PendingMonitorOutput = {
  record: MonitorRecord
  batches: OutputBatch[]
}

export type DispatchedMonitorOutput = {
  record: MonitorRecord
  batch: OutputBatch
  content: string
  dispatchedAt: number
}
