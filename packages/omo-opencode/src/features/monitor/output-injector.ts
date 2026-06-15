import {
  createInternalAgentTextPart,
  isAmbiguousPostDispatchPromptFailure,
  log,
  withInternalNoReplyMarker,
} from "../../shared"
import { isSessionActive as isOpenCodeSessionActive, settleAfterSessionIdle } from "../../shared/session-idle-settle"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../shared/prompt-async-gate"
import type { InternalPromptDispatchArgs, InternalPromptDispatchResult, PromptAsyncInput } from "../../shared/prompt-async-gate/types"
import { formatMonitorBatch } from "./envelope"
import {
  hasAcceptedMessageAfterDispatchedMonitorOutput,
  isUserMessageInProgress,
  latestAssistantTurnBlocksMonitorOutput,
} from "./output-injector-session-inspect"
import type { DispatchedMonitorOutput, MonitorOutputInjectorDeps, PendingMonitorOutput } from "./output-injector-types"
import type { MonitorRecord, OutputBatch } from "./types"

const SAME_SOURCE_RETRY_MS = 2_000

export class MonitorOutputInjector {
  private readonly pendingOutputs: Map<string, PendingMonitorOutput> = new Map()
  private readonly dispatchedOutputs: Map<string, DispatchedMonitorOutput> = new Map()
  private readonly deliveredSources: Set<string> = new Set()

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

    if (await latestAssistantTurnBlocksMonitorOutput(this.deps.client, this.deps.directory, sessionID)) {
      this.scheduleFlush(monitorId)
      log("[monitor] Deferred output injection because latest assistant turn blocks internal prompts:", { sessionID, monitorId })
      return
    }

    if (await isUserMessageInProgress(this.deps.client, this.deps.directory, sessionID, this.now(), this.deps.userMessageInProgressWindowMs)) {
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
          && await hasAcceptedMessageAfterDispatchedMonitorOutput(this.deps.client, this.deps.directory, sessionID, {
            record,
            batch,
            content,
            dispatchedAt: dispatchStartedAt,
          }, this.deps.acceptedMessageSkewMs)
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

  private trackDelivered(source: string, output: DispatchedMonitorOutput): void {
    this.deliveredSources.add(source)
    this.dispatchedOutputs.set(source, output)
  }

  private createSource(record: MonitorRecord, batch: OutputBatch): string {
    return `monitor-output:${record.id}:batch-${batch.batchSeq}`
  }
}
