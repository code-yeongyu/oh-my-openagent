import type { ComponentLogger } from "../../extension/types"
import { tryAcquireJudgeSlot } from "./memorian-concurrency"
import type { MemorianGatePort } from "./memorian-wiring"
import type { ToolArgWindow } from "./recall-query-planner-tools"
import { toolArgTexts } from "./recall-query-planner-tools"
import type { ChildModelRegistry } from "./model-registry-resolver"
import type { MemoryIdentityContext } from "./context"
import type { CollectedRecallCandidates, RecallSessionSnapshot } from "./recall-wiring"
import type { RecallNudge } from "@oh-my-opencode/memory-core"

const MAX_LAUNCHES_PER_SESSION = 200
/** Judge deadline for a `tool_call`-origin launch; settle-origin launches keep the runner default. */
export const TOOL_CALL_JUDGE_DEADLINE_MS = 90_000

type Origin = "tool_call" | "settled"
type ToolCallPayload = { readonly toolName: string; readonly input: Record<string, unknown> }
type LaunchResult = {
  readonly status: "active" | "skipped" | "failed" | "dropped" | "nudged" | "empty"
  readonly nudges?: readonly RecallNudge[]
}
type Trailing = {
  readonly snapshot: RecallSessionSnapshot
  readonly extraTexts: readonly string[]
  readonly fingerprint: string
  readonly modelRegistry?: ChildModelRegistry
  readonly compactionEpoch: number
  readonly origin: Origin
}

export interface MemorianTriggerOptions {
  readonly snapshotSession: (eventCtx: unknown) => RecallSessionSnapshot | undefined
  readonly resolveModelRegistry: (eventCtx: unknown) => ChildModelRegistry | undefined
  readonly collectCandidatesFromSnapshot: (
    snapshot: RecallSessionSnapshot,
    extraTexts?: readonly string[],
  ) => Promise<CollectedRecallCandidates | undefined>
  readonly runnerFor: (context: MemoryIdentityContext) => MemorianGatePort
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly onAccepted: (
    sessionId: string,
    context: MemoryIdentityContext,
    nudges: readonly RecallNudge[],
    epoch: number,
  ) => Promise<void>
  readonly report: (sessionId: string, outcome: LaunchResult, collected: CollectedRecallCandidates) => void
  readonly currentCompactionEpoch: (sessionId: string) => number
  readonly argWindow: ToolArgWindow
  readonly logger?: ComponentLogger
}

export interface MemorianTrigger {
  onToolCall(payload: unknown, eventCtx: unknown): void
  onSettled(eventCtx: unknown): void
  onCompactionAccepted(sessionId: string): void
  onSessionShutdown(sessionId: string): void
  whenIdle(): Promise<void>
}

export function createMemorianTrigger(options: MemorianTriggerOptions): MemorianTrigger {
  const lastFingerprint = new Map<string, string>()
  const trailing = new Map<string, Trailing>()
  const launchCounts = new Map<string, number>()
  const busySessions = new Set<string>()
  const inFlight = new Set<Promise<void>>()

  function warn(message: string, error?: unknown): void {
    options.logger?.warn(message, error === undefined ? undefined : { error: describe(error) })
  }

  function track(task: () => Promise<void>): void {
    let promise: Promise<void>
    promise = task()
      .catch((error: unknown) => warn("memorian trigger failed", error))
      .finally(() => inFlight.delete(promise))
    inFlight.add(promise)
  }

  function capture(eventCtx: unknown, origin: Origin, payload?: ToolCallPayload): void {
    let snapshot: RecallSessionSnapshot | undefined
    let modelRegistry: ChildModelRegistry | undefined
    let extraTexts: readonly string[] = []
    try {
      snapshot = options.snapshotSession(eventCtx)
      modelRegistry = options.resolveModelRegistry(eventCtx)
      if (snapshot !== undefined) {
        if (payload !== undefined) options.argWindow.push(snapshot.id, toolArgTexts(payload.toolName, payload.input))
        extraTexts = options.argWindow.texts(snapshot.id)
      }
    } catch (error) {
      warn("memorian trigger synchronous snapshot skipped", error)
    }
    if (snapshot === undefined) return
    let epoch: number
    try {
      epoch = options.currentCompactionEpoch(snapshot.id)
    } catch (error) {
      warn("memorian trigger compaction epoch snapshot skipped", error)
      return
    }
    track(() => run(snapshot, extraTexts, modelRegistry, origin, epoch))
  }

  async function run(
    snapshot: RecallSessionSnapshot,
    extraTexts: readonly string[],
    modelRegistry: ChildModelRegistry | undefined,
    origin: Origin,
    launchEpoch: number,
  ): Promise<void> {
    const owner = !busySessions.has(snapshot.id)
    if (owner) busySessions.add(snapshot.id)
    let keepBusy = false
    try {
      const collected = await options.collectCandidatesFromSnapshot(snapshot, extraTexts)
      if (collected === undefined) return
      const context = options.resolveContext(collected.sessionId)
    if (context === undefined) return
    const fingerprint = collected.candidates.map((candidate) => candidate.path).sort().join("\n")
      if (fingerprint === lastFingerprint.get(collected.sessionId)) {
        options.logger?.info("memorian trigger skipped", { sessionId: collected.sessionId, reason: "unchanged_candidates" })
        return
      }
      const count = launchCounts.get(collected.sessionId) ?? 0
      if (count >= MAX_LAUNCHES_PER_SESSION) {
        options.logger?.info("memorian trigger skipped", { sessionId: collected.sessionId, reason: "launch_ceiling" })
        return
      }
      if (!owner) {
      trailing.set(collected.sessionId, {
        snapshot,
        extraTexts,
        fingerprint,
        ...(modelRegistry === undefined ? {} : { modelRegistry }),
        compactionEpoch: launchEpoch,
        origin,
      })
        return
      }
      const release = tryAcquireJudgeSlot()
      if (release === undefined) {
        options.logger?.info("memorian trigger skipped", { sessionId: collected.sessionId, reason: "judge_cap" })
        return
      }
      lastFingerprint.set(collected.sessionId, fingerprint)
      launchCounts.set(collected.sessionId, count + 1)
      try {
      const runner = options.runnerFor(context)
      const result = await runner.launch({
        sessionId: collected.sessionId,
        candidates: collected.candidates,
        surfaced: collected.surfaced,
        maxItems: collected.maxItems,
        transcript: collected.transcript,
        ...(modelRegistry === undefined ? {} : { modelRegistry }),
        compactionEpoch: launchEpoch,
        currentCompactionEpoch: () => options.currentCompactionEpoch(collected.sessionId),
        ...(origin === "tool_call" ? { deadlineMs: TOOL_CALL_JUDGE_DEADLINE_MS } : {}),
      })
      if (!isLaunchResult(result)) return
      if (result.status === "active") {
        keepBusy = true
        trailing.set(collected.sessionId, {
          snapshot,
          extraTexts,
          fingerprint,
          ...(modelRegistry === undefined ? {} : { modelRegistry }),
          compactionEpoch: launchEpoch,
          origin,
        })
        await runner.whenIdle?.()
        const pending = trailing.get(collected.sessionId)
        trailing.delete(collected.sessionId)
        busySessions.delete(collected.sessionId)
        keepBusy = false
        release()
        if (pending !== undefined && pending.fingerprint !== fingerprint) {
          await run(pending.snapshot, pending.extraTexts, pending.modelRegistry, pending.origin, pending.compactionEpoch)
        }
        return
      }
      if (result.status === "nudged") {
        await options.onAccepted(collected.sessionId, context, result.nudges ?? [], launchEpoch)
      } else if (result.status === "skipped" || result.status === "failed" || result.status === "dropped") {
        options.report(collected.sessionId, result, collected)
      }
    } catch (error) {
      warn("memorian trigger launch failed", error)
      } finally {
        release()
      }
    } finally {
      if (owner && !keepBusy) busySessions.delete(snapshot.id)
    }
  }

  function clearSession(sessionId: string): void {
    lastFingerprint.delete(sessionId)
    trailing.delete(sessionId)
    launchCounts.delete(sessionId)
    busySessions.delete(sessionId)
    try {
      options.argWindow.clear(sessionId)
    } catch (error) {
      warn("memorian trigger argument window clear failed", error)
    }
  }

  return {
    onToolCall(payload, eventCtx): void {
      if (isToolCallPayload(payload)) capture(eventCtx, "tool_call", payload)
      else capture(eventCtx, "tool_call")
    },
    onSettled(eventCtx): void {
      capture(eventCtx, "settled")
    },
    onCompactionAccepted: clearSession,
    onSessionShutdown: clearSession,
    async whenIdle(): Promise<void> {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}

function isToolCallPayload(value: unknown): value is ToolCallPayload {
  if (!isRecord(value)) return false
  return typeof value.toolName === "string" && isRecord(value.input)
}

function isLaunchResult(value: unknown): value is LaunchResult {
  return isRecord(value) && typeof value.status === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
