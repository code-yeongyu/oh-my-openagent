import {
  createInternalAgentTextPart,
  isAmbiguousPostDispatchPromptFailure,
  isSyntheticOrInternalUserMessage,
  log,
  normalizeSDKResponse,
  withInternalNoReplyMarker,
} from "../../shared"
import { isSessionActive as isOpenCodeSessionActive, settleAfterSessionIdle } from "../../shared/session-idle-settle"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../shared/prompt-async-gate"
import { latestAssistantTurnBlocksInternalPrompt } from "../../shared/prompt-async-gate/pending-tool-turn"
import type { InternalPromptDispatchArgs, InternalPromptDispatchResult, PromptAsyncInput, PromptDispatchClient } from "../../shared/prompt-async-gate/types"
import { formatMonitorBatch } from "./envelope"
import type { MonitorRecord, OutputBatch } from "./types"

type MonitorPromptClient = PromptDispatchClient & InternalPromptDispatchArgs<PromptAsyncInput>["client"]

type MonitorOutputInjectorDeps = {
  readonly client: MonitorPromptClient
  readonly directory: string
  readonly pendingRetryMs: number
  readonly acceptedMessageSkewMs: number
  readonly userMessageInProgressWindowMs: number
  readonly parentSessionActivityInProgressWindowMs?: number
  readonly postDispatchHoldMs: number
  readonly dispatchInternalPrompt?: (args: InternalPromptDispatchArgs<PromptAsyncInput>) => Promise<InternalPromptDispatchResult>
  readonly now?: () => number
  readonly settleAfterSessionIdle?: () => Promise<void>
  readonly scheduleFlush?: (monitorId: string, delayMs: number, operation: () => Promise<void>) => void
}

type MonitorSessionMessage = {
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

type PendingMonitorOutput = {
  record: MonitorRecord
  batches: OutputBatch[]
}

type DispatchedMonitorOutput = {
  record: MonitorRecord
  batch: OutputBatch
  content: string
  dispatchedAt: number
}

const SAME_SOURCE_RETRY_MS = 2_000

export class MonitorOutputInjector {
  private readonly pendingOutputs: Map<string, PendingMonitorOutput> = new Map()
  private readonly dispatchedOutputs: Map<string, DispatchedMonitorOutput> = new Map()
  private readonly deliveredSources: Set<string> = new Set()
  private readonly recentParentSessionActivity: Map<string, number> = new Map()

  constructor(private readonly deps: MonitorOutputInjectorDeps) {
    if (deps.postDispatchHoldMs <= 0) {
      throw new Error("MonitorOutputInjector requires a nonzero postDispatchHoldMs")
    }
  }

  queueBatch(record: MonitorRecord, batch: OutputBatch): void {
    const source = this.createSource(record, batch)
    if (this.deliveredSources.has(source)) {
      return
    }

    const pending = this.pendingOutputs.get(record.id)
    if (pending) {
      pending.record = record
      if (!pending.batches.some((existingBatch) => this.createSource(record, existingBatch) === source)) {
        pending.batches.push(batch)
      }
    } else {
      this.pendingOutputs.set(record.id, { record, batches: [batch] })
    }

    this.scheduleFlush(record.id, 0)
  }

  getPendingBatches(monitorId: string): OutputBatch[] {
    return [...this.pendingOutputs.get(monitorId)?.batches ?? []]
  }

  recordParentSessionActivity(sessionID: string): void {
    this.recentParentSessionActivity.set(sessionID, this.now())
  }

  async flushMonitor(monitorId: string): Promise<void> {
    const pending = this.pendingOutputs.get(monitorId)
    if (!pending || pending.batches.length === 0) {
      this.pendingOutputs.delete(monitorId)
      return
    }

    const sessionID = pending.record.parentSessionId
    const sessionActive = await this.isSessionActive(sessionID)
    if (!sessionActive) {
      await this.settleAfterSessionIdle()
      if (await this.isSessionActive(sessionID)) {
        this.scheduleFlush(monitorId)
        return
      }
    }

    if (sessionActive) {
      this.scheduleFlush(monitorId)
      return
    }

    if (this.hasRecentParentSessionActivity(sessionID)) {
      this.scheduleFlush(monitorId)
      log("[monitor] Deferred output injection because parent session activity is still fresh:", { sessionID, monitorId })
      return
    }

    if (await this.latestAssistantTurnBlocksMonitorOutput(sessionID)) {
      this.scheduleFlush(monitorId)
      log("[monitor] Deferred output injection because latest assistant turn blocks internal prompts:", { sessionID, monitorId })
      return
    }

    if (await this.isUserMessageInProgress(sessionID)) {
      this.scheduleFlush(monitorId)
      log("[monitor] Deferred output injection because user message just arrived:", { sessionID, monitorId })
      return
    }

    while (pending.batches.length > 0) {
      const batch = pending.batches[0]
      if (!batch) {
        break
      }

      const source = this.createSource(pending.record, batch)
      if (this.deliveredSources.has(source)) {
        pending.batches.shift()
        continue
      }

      pending.batches.shift()
      if (pending.batches.length === 0) {
        this.pendingOutputs.delete(monitorId)
      }

      const delivered = await this.dispatchBatch(pending.record, batch, source)
      if (!delivered) {
        this.requeueBatch(pending.record, batch)
        return
      }
    }

    if (pending.batches.length === 0) {
      this.pendingOutputs.delete(monitorId)
    }
  }

  private async dispatchBatch(record: MonitorRecord, batch: OutputBatch, source: string): Promise<boolean> {
    const sessionID = record.parentSessionId
    const content = formatMonitorBatch(record, batch, record.counters)
    const dispatchStartedAt = this.now()

    try {
      const promptResult = await this.dispatchInternalPrompt({
        mode: "async",
        client: this.deps.client,
        sessionID,
        source,
        settleMs: 0,
        queueBehavior: "defer",
        postDispatchHoldMs: this.deps.postDispatchHoldMs,
        checkStatus: true,
        checkToolState: true,
        input: {
          path: { id: sessionID },
          body: {
            noReply: true,
            parts: [withInternalNoReplyMarker(createInternalAgentTextPart(content))],
          },
          query: { directory: this.deps.directory },
        },
      })

      if (promptResult.status === "failed") {
        if (
          isAmbiguousPostDispatchPromptFailure(promptResult)
          && await this.hasAcceptedMessageAfterDispatchedMonitorOutput(sessionID, {
            record,
            batch,
            content,
            dispatchedAt: dispatchStartedAt,
          })
        ) {
          this.trackDelivered(source, { record, batch, content, dispatchedAt: dispatchStartedAt })
          log("[monitor] Treated failed monitor output prompt as accepted after observing session history:", {
            sessionID,
            monitorId: record.id,
            batchSeq: batch.batchSeq,
            error: promptResult.error,
          })
          return true
        }
        throw promptResult.error
      }

      if (promptResult.status === "reserved" && promptResult.reservedBy === source) {
        if (this.dispatchedOutputs.has(source)) {
          log("[monitor] Suppressed duplicate monitor output during promptAsync gate hold:", {
            sessionID,
            monitorId: record.id,
            batchSeq: batch.batchSeq,
          })
          return true
        }
        this.scheduleFlush(record.id, SAME_SOURCE_RETRY_MS)
        return false
      }

      if (!isInternalPromptDispatchAccepted(promptResult)) {
        this.scheduleFlush(record.id)
        log("[monitor] Deferred output injection skipped by promptAsync gate:", {
          sessionID,
          monitorId: record.id,
          batchSeq: batch.batchSeq,
          status: promptResult.status,
        })
        return false
      }

      this.trackDelivered(source, { record, batch, content, dispatchedAt: dispatchStartedAt })
      log("[monitor] Sent deferred monitor output:", { sessionID, monitorId: record.id, batchSeq: batch.batchSeq })
      return true
    } catch (error) {
      this.scheduleFlush(record.id)
      log("[monitor] Failed to send deferred monitor output:", { sessionID, monitorId: record.id, batchSeq: batch.batchSeq, error })
      return false
    }
  }

  private requeueBatch(record: MonitorRecord, batch: OutputBatch): void {
    const source = this.createSource(record, batch)
    if (this.deliveredSources.has(source)) {
      return
    }

    const pending = this.pendingOutputs.get(record.id)
    if (pending) {
      pending.record = record
      if (!pending.batches.some((existingBatch) => this.createSource(record, existingBatch) === source)) {
        pending.batches.unshift(batch)
      }
      return
    }

    this.pendingOutputs.set(record.id, { record, batches: [batch] })
  }

  private async isSessionActive(sessionID: string): Promise<boolean> {
    return isOpenCodeSessionActive(this.deps.client, sessionID)
  }

  private async settleAfterSessionIdle(): Promise<void> {
    if (this.deps.settleAfterSessionIdle) {
      await this.deps.settleAfterSessionIdle()
      return
    }
    await settleAfterSessionIdle()
  }

  private dispatchInternalPrompt(args: InternalPromptDispatchArgs<PromptAsyncInput>): Promise<InternalPromptDispatchResult> {
    return (this.deps.dispatchInternalPrompt ?? dispatchInternalPrompt)(args)
  }

  private scheduleFlush(monitorId: string, delayMs = this.deps.pendingRetryMs): void {
    this.deps.scheduleFlush?.(monitorId, delayMs, () => this.flushMonitor(monitorId))
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private hasRecentParentSessionActivity(sessionID: string): boolean {
    const windowMs = this.deps.parentSessionActivityInProgressWindowMs ?? 0
    if (windowMs <= 0) {
      return false
    }
    const lastActivityAt = this.recentParentSessionActivity.get(sessionID)
    if (lastActivityAt === undefined) {
      return false
    }
    if (this.now() - lastActivityAt <= windowMs) {
      return true
    }
    this.recentParentSessionActivity.delete(sessionID)
    return false
  }

  private async latestAssistantTurnBlocksMonitorOutput(sessionID: string): Promise<boolean> {
    const messages = await this.loadMonitorSessionMessages(sessionID)
    return latestAssistantTurnBlocksInternalPrompt(messages)
  }

  private async loadMonitorSessionMessages(sessionID: string): Promise<MonitorSessionMessage[]> {
    try {
      const messagesResp = await this.deps.client.session?.messages?.({
        path: { id: sessionID },
        query: { directory: this.deps.directory },
      })
      return normalizeSDKResponse(messagesResp, [] as MonitorSessionMessage[])
    } catch (error) {
      log("[monitor] Failed to inspect parent session messages for output injection safety:", { sessionID, error })
      return []
    }
  }

  private getMessageRole(message: MonitorSessionMessage): string | undefined {
    return message.info?.role ?? message.role
  }

  private getMessageCreatedAt(message: MonitorSessionMessage): number | undefined {
    const value = message.info?.time?.created ?? message.time?.created
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    if (value instanceof Date) {
      return value.getTime()
    }
    return undefined
  }

  private async isUserMessageInProgress(sessionID: string): Promise<boolean> {
    if (this.deps.userMessageInProgressWindowMs <= 0) {
      return false
    }
    const messages = await this.loadMonitorSessionMessages(sessionID)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message) {
        continue
      }
      const role = this.getMessageRole(message)
      if (role === "user") {
        if (isSyntheticOrInternalUserMessage(message)) {
          continue
        }
        const createdAt = this.getMessageCreatedAt(message)
        if (createdAt === undefined) {
          return false
        }
        return this.now() - createdAt <= this.deps.userMessageInProgressWindowMs
      }
      if (role === "assistant" || role === "tool") {
        return false
      }
    }
    return false
  }

  private monitorMessageHasOutput(message: MonitorSessionMessage): boolean {
    const role = this.getMessageRole(message)
    if (role !== "assistant" && role !== "tool") {
      return false
    }
    if (!message.parts || message.parts.length === 0) {
      return role === "assistant"
    }
    return message.parts.some((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return typeof part.text === "string" && part.text.trim().length > 0
      }
      if (
        part.type === "tool"
        || part.type === "tool_use"
        || part.type === "tool-call"
        || part.type === "tool-invocation"
        || part.type === "tool_result"
        || part.type === "tool-result"
      ) {
        return true
      }
      if (part.content !== undefined) {
        if (typeof part.content === "string") {
          return part.content.trim().length > 0
        }
        if (Array.isArray(part.content)) {
          return part.content.length > 0
        }
        return true
      }
      return false
    })
  }

  private monitorMessageContainsBatch(message: MonitorSessionMessage, output: DispatchedMonitorOutput): boolean {
    if (this.getMessageRole(message) !== "user") {
      return false
    }
    const monitorMarker = `monitor_id: ${output.record.id}`
    const batchMarker = `batch: ${output.batch.batchSeq}`
    return message.parts?.some((part) =>
      typeof part.text === "string"
      && part.text.includes("[OMO MONITOR OUTPUT]")
      && part.text.includes(monitorMarker)
      && part.text.includes(batchMarker)
    ) ?? false
  }

  private async hasAcceptedMessageAfterDispatchedMonitorOutput(
    sessionID: string,
    output: DispatchedMonitorOutput,
  ): Promise<boolean> {
    const messages = await this.loadMonitorSessionMessages(sessionID)
    return messages.some((message) => {
      const createdAt = this.getMessageCreatedAt(message)
      if (createdAt === undefined) {
        return false
      }
      if (
        createdAt >= output.dispatchedAt - this.deps.acceptedMessageSkewMs
        && this.monitorMessageContainsBatch(message, output)
      ) {
        return true
      }
      return createdAt >= output.dispatchedAt && this.monitorMessageHasOutput(message)
    })
  }

  private trackDelivered(source: string, output: DispatchedMonitorOutput): void {
    this.deliveredSources.add(source)
    this.dispatchedOutputs.set(source, output)
  }

  private createSource(record: MonitorRecord, batch: OutputBatch): string {
    return `monitor-output:${record.id}:batch-${batch.batchSeq}`
  }
}
