import type { RecallCandidate } from "@oh-my-opencode/memory-core"
import type { ChildModelRegistry } from "./model-registry-resolver"
import type { RecallTranscriptTurn } from "./recall-wiring"

import type { ComponentLogger } from "../../extension/types"
import { createOncePerSessionGuard } from "../task/usage-guidance"
import { GATE_ENTRY_TYPE, type MemorianGateRecord } from "./memorian-notice"
import type { MemoryIdentityContext } from "./context"
import type { CollectedRecallCandidates } from "./recall-wiring"

export interface MemorianGatePort {
  launch(input: {
    readonly sessionId: string
    readonly candidates: readonly RecallCandidate[]
    readonly surfaced: ReadonlySet<string>
    readonly maxItems: number
    readonly transcript: readonly RecallTranscriptTurn[]
    readonly modelRegistry?: ChildModelRegistry | undefined
    readonly compactionEpoch?: number
    readonly currentCompactionEpoch?: () => number
    readonly deadlineMs?: number
  }): Promise<unknown>
  cancel?(): Promise<void>
  whenIdle?(): Promise<void>
}

export type MemorianLaunchOutcome = {
  readonly status: "active" | "skipped" | "failed" | "dropped" | "nudged" | "empty"
  readonly cause?: string
  readonly model?: string
  readonly candidateCount?: number
  readonly reason?: string
  readonly runId?: string
  readonly nudges?: readonly import("@oh-my-opencode/memory-core").RecallNudge[]
}

export interface MemorianGateWiringOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly runnerFor: (context: MemoryIdentityContext) => MemorianGatePort
  readonly logger?: ComponentLogger
}

export interface MemorianGateWiring {
  reportOutcome(sessionId: string, outcome: MemorianLaunchOutcome, collected: CollectedRecallCandidates): void
  attachEntrySink(appendEntry: (customType: string, data?: unknown) => void): void
  onCompactionAccepted(sessionId: string): void
  onSessionShutdown(sessionId: string): Promise<void>
  currentCompactionEpoch(sessionId: string): number
  whenIdle(): Promise<void>
}

export function createMemorianGateWiring(options: MemorianGateWiringOptions): MemorianGateWiring {
  const skippedOnce = createOncePerSessionGuard()
  const compactionEpochs = new Map<string, number>()
  let appendEntry: ((customType: string, data?: unknown) => void) | undefined

  function epochOf(sessionId: string): number {
    return compactionEpochs.get(sessionId) ?? 0
  }

  return {
    attachEntrySink(sink): void {
      appendEntry = sink
    },
    reportOutcome(sessionId, outcome, collected): void {
      if (outcome.status !== "skipped" && outcome.status !== "failed" && outcome.status !== "dropped") return
      const cause = outcome.cause ?? "unknown"
      if (outcome.status === "skipped" && !skippedOnce(`${sessionId}:${cause}`)) return
      appendEntry?.(GATE_ENTRY_TYPE, {
        version: 1,
        status: outcome.status,
        cause,
        ...(outcome.model === undefined ? {} : { model: outcome.model }),
        candidateCount: outcome.candidateCount ?? collected.candidates.length,
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
        ...(outcome.runId === undefined ? {} : { runId: outcome.runId }),
      } satisfies MemorianGateRecord)
    },
    async onSessionShutdown(sessionId): Promise<void> {
      compactionEpochs.delete(sessionId)
      const context = options.resolveContext(sessionId)
      if (context === undefined) return
      const runner = options.runnerFor(context)
      await runner.cancel?.()
      await runner.whenIdle?.()
    },
    onCompactionAccepted(sessionId): void {
      compactionEpochs.set(sessionId, epochOf(sessionId) + 1)
    },
    currentCompactionEpoch: epochOf,
    async whenIdle(): Promise<void> {},

  }
}
