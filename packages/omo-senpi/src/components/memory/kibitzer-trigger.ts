import type { ComponentLogger } from "../../extension/types"
import { tryAcquireJudgeSlot } from "./kibitzer-concurrency"
import type { KibitzerGatePort } from "./kibitzer-wiring"
import type { ToolArgWindow } from "./recall-query-planner-tools"
import { toolArgTexts } from "./recall-query-planner-tools"
import type { ChildModelRegistry } from "./model-registry-resolver"
import type { MemoryIdentityContext } from "./context"
import type { CollectedRecallCandidates, RecallSessionSnapshot } from "./recall-wiring"
import type { RecallNudge } from "@oh-my-opencode/memory-core"

const MAX_LAUNCHES_PER_SESSION = 200
/** Only tool-call launches override the runner's default deadline. */
export const TOOL_CALL_JUDGE_DEADLINE_MS = 90_000

type Origin =
  | { readonly origin: "prompt"; readonly promptText: string }
  | { readonly origin: "tool_call"; readonly payload?: ToolCallPayload }
  | { readonly origin: "settled" }
type ToolCallPayload = { readonly toolName: string; readonly input: Record<string, unknown> }
type LaunchResult = {
  readonly status: "active" | "skipped" | "failed" | "dropped" | "nudged" | "empty"
  readonly nudges?: readonly RecallNudge[]
  readonly cause?: string
}
type CapturedTrigger = {
  readonly snapshot: RecallSessionSnapshot
  readonly extraTexts: readonly string[]
  readonly modelRegistry?: ChildModelRegistry
  readonly compactionEpoch: number
  readonly source: Origin
}
type Trailing = CapturedTrigger & { readonly fingerprint: string }

export interface KibitzerTriggerOptions {
  readonly snapshotSession: (eventCtx: unknown) => RecallSessionSnapshot | undefined
  readonly resolveModelRegistry: (eventCtx: unknown) => ChildModelRegistry | undefined
  readonly collectCandidatesFromSnapshot: (
    snapshot: RecallSessionSnapshot,
    extraTexts?: readonly string[],
  ) => Promise<CollectedRecallCandidates | undefined>
  readonly runnerFor: (context: MemoryIdentityContext) => KibitzerGatePort
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

export interface KibitzerTrigger {
  onPrompt(promptText: string, eventCtx: unknown): void
  onToolCall(payload: unknown, eventCtx: unknown): void
  onSettled(eventCtx: unknown): void
  onCompactionAccepted(sessionId: string): void
  onSessionShutdown(sessionId: string): void
  whenIdle(): Promise<void>
}

export function createKibitzerTrigger(options: KibitzerTriggerOptions): KibitzerTrigger {
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
      .catch((error: unknown) => warn("kibitzer trigger failed", error))
      .finally(() => inFlight.delete(promise))
    inFlight.add(promise)
  }

  function capture(eventCtx: unknown, source: Origin): void {
    let snapshot: RecallSessionSnapshot | undefined
    let modelRegistry: ChildModelRegistry | undefined
    let extraTexts: readonly string[] = []
    try {
      snapshot = options.snapshotSession(eventCtx)
      modelRegistry = options.resolveModelRegistry(eventCtx)
      if (snapshot !== undefined) {
        switch (source.origin) {
          case "prompt":
            extraTexts = [source.promptText]
            break
          case "tool_call":
            if (source.payload !== undefined) options.argWindow.push(snapshot.id, toolArgTexts(source.payload.toolName, source.payload.input))
            extraTexts = options.argWindow.texts(snapshot.id)
            break
          case "settled":
            extraTexts = options.argWindow.texts(snapshot.id)
            break
          default: source satisfies never
        }
      }
    } catch (error) {
      warn("kibitzer trigger synchronous snapshot skipped", error)
    }
    if (snapshot === undefined) return
    let epoch: number
    try {
      epoch = options.currentCompactionEpoch(snapshot.id)
    } catch (error) {
      warn("kibitzer trigger compaction epoch snapshot skipped", error)
      return
    }
    track(() => run({ snapshot, extraTexts, source, compactionEpoch: epoch, ...(modelRegistry === undefined ? {} : { modelRegistry }) }))
  }

  async function run(captured: CapturedTrigger): Promise<void> {
    const { snapshot, extraTexts, modelRegistry, source, compactionEpoch: launchEpoch } = captured
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
        options.logger?.info("kibitzer trigger skipped", { sessionId: collected.sessionId, reason: "unchanged_candidates" })
        return
      }
      const count = launchCounts.get(collected.sessionId) ?? 0
      if (count >= MAX_LAUNCHES_PER_SESSION) {
        options.logger?.info("kibitzer trigger skipped", { sessionId: collected.sessionId, reason: "launch_ceiling" })
        return
      }
      if (!owner) {
        trailing.set(collected.sessionId, { ...captured, fingerprint })
        return
      }
      const release = tryAcquireJudgeSlot()
      if (release === undefined) {
        options.logger?.info("kibitzer trigger skipped", { sessionId: collected.sessionId, reason: "judge_cap" })
        return
      }
      const previousFingerprint = lastFingerprint.get(collected.sessionId)
      lastFingerprint.set(collected.sessionId, fingerprint)
      launchCounts.set(collected.sessionId, count + 1)
      try {
      const runner = options.runnerFor(context)
      let transcript = collected.transcript
      let deadlineMs: number | undefined
      switch (source.origin) {
        case "prompt":
          if (transcript.findLast((turn) => turn.role === "user")?.text !== source.promptText) {
            transcript = [...transcript, { role: "user", text: source.promptText }]
          }
          break
        case "tool_call": deadlineMs = TOOL_CALL_JUDGE_DEADLINE_MS; break
        case "settled": break
        default: source satisfies never
      }
      const result = await runner.launch({
        sessionId: collected.sessionId,
        candidates: collected.candidates,
        surfaced: collected.surfaced,
        maxItems: collected.maxItems,
        transcript,
        ...(modelRegistry === undefined ? {} : { modelRegistry }),
        compactionEpoch: launchEpoch,
        currentCompactionEpoch: () => options.currentCompactionEpoch(collected.sessionId),
        ...(deadlineMs === undefined ? {} : { deadlineMs }),
      })
      if (!isLaunchResult(result)) return
      // Cooldown did not judge these candidates; retain only the previous reservation.
      if (result.status === "skipped" && result.cause === "cooldown"
        && lastFingerprint.get(collected.sessionId) === fingerprint) {
        if (previousFingerprint === undefined) lastFingerprint.delete(collected.sessionId)
        else lastFingerprint.set(collected.sessionId, previousFingerprint)
      }
      if (result.status === "active") {
        keepBusy = true
        trailing.set(collected.sessionId, { ...captured, fingerprint })
        await runner.whenIdle?.()
        const pending = trailing.get(collected.sessionId)
        trailing.delete(collected.sessionId)
        busySessions.delete(collected.sessionId)
        keepBusy = false
        release()
        if (pending !== undefined && pending.fingerprint !== fingerprint) {
          await run(pending)
        }
        return
      }
      if (result.status === "nudged") {
        await options.onAccepted(collected.sessionId, context, result.nudges ?? [], launchEpoch)
      } else if (result.status === "skipped" || result.status === "failed" || result.status === "dropped") {
        options.report(collected.sessionId, result, collected)
      }
    } catch (error) {
      warn("kibitzer trigger launch failed", error)
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
      warn("kibitzer trigger argument window clear failed", error)
    }
  }

  return {
    onPrompt(promptText, eventCtx): void {
      capture(eventCtx, { origin: "prompt", promptText })
    },
    onToolCall(payload, eventCtx): void {
      if (isToolCallPayload(payload)) capture(eventCtx, { origin: "tool_call", payload })
      else capture(eventCtx, { origin: "tool_call" })
    },
    onSettled(eventCtx): void {
      capture(eventCtx, { origin: "settled" })
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
