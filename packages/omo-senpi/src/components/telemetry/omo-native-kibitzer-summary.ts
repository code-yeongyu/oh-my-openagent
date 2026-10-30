import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { KibitzerTelemetryObserver, KibitzerTelemetrySignal } from "../memory/kibitzer/wake-observers"
import { sharedKibitzerTelemetryObservers } from "../memory/kibitzer/wake-observers"
import { maskProviderAndModel } from "./product-identity"

export type KibitzerSessionSnapshot = {
  readonly wakes: number
  readonly wakesWithNudge: number
  readonly wakesFailed: number
  readonly wakesDeadline: number
  readonly wakesToolBudget: number
  readonly offers: number
  readonly bufferedCooldown: number
  readonly bufferedNoNewCandidate: number
  readonly nudges: number
  readonly firstNudgeWake: number
  readonly nudgeGapsMs: readonly number[]
  readonly wakeSpanMs: number
  readonly durationMsTotal: number
  readonly slotWaitMsTotal: number
  readonly toolCalls: number
  readonly candidates: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly generations: number
  readonly modelTop: string | undefined
}

export type KibitzerTelemetryRegistry = {
  readonly record: (signal: KibitzerTelemetrySignal, atMs: number) => void
  readonly snapshot: (sessionId: string) => KibitzerSessionSnapshot | undefined
  readonly clear: (sessionId: string) => void
  readonly size: () => number
}

export type OmoNativeKibitzerSummaryOptions = {
  readonly captureEvent: (name: "kibitzer_summary", properties: EventTelemetryProperties) => void
  readonly hashSessionId: (rawId: string) => string
  readonly now?: () => number
  readonly registry?: KibitzerTelemetryRegistry
  readonly subscribe?: (observer: KibitzerTelemetryObserver) => () => void
}

type Accumulator = {
  wakes: number
  wakesWithNudge: number
  wakesFailed: number
  wakesDeadline: number
  wakesToolBudget: number
  offers: number
  bufferedCooldown: number
  bufferedNoNewCandidate: number
  nudges: number
  firstNudgeWake: number
  lastNudgeAtMs: number | undefined
  nudgeGapsMs: number[]
  firstWakeAtMs: number | undefined
  lastWakeAtMs: number
  durationMsTotal: number
  slotWaitMsTotal: number
  toolCalls: number
  candidates: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  generations: number
  modelCounts: Map<string, number>
}

function emptyAccumulator(): Accumulator {
  return {
    wakes: 0, wakesWithNudge: 0, wakesFailed: 0, wakesDeadline: 0, wakesToolBudget: 0,
    offers: 0, bufferedCooldown: 0, bufferedNoNewCandidate: 0,
    nudges: 0, firstNudgeWake: 0, lastNudgeAtMs: undefined, nudgeGapsMs: [],
    firstWakeAtMs: undefined, lastWakeAtMs: 0,
    durationMsTotal: 0, slotWaitMsTotal: 0, toolCalls: 0, candidates: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    generations: 0, modelCounts: new Map(),
  }
}

function recordWake(entry: Accumulator, signal: Extract<KibitzerTelemetrySignal, { kind: "wake" }>, atMs: number): void {
  entry.wakes += 1
  if (signal.status === "failed") entry.wakesFailed += 1
  if (signal.status === "deadline") entry.wakesDeadline += 1
  if (signal.status === "tool_budget_exceeded") entry.wakesToolBudget += 1
  if (signal.nudges > 0) {
    entry.wakesWithNudge += 1
    entry.nudges += signal.nudges
    if (entry.firstNudgeWake === 0) entry.firstNudgeWake = signal.wake
    if (entry.lastNudgeAtMs !== undefined) entry.nudgeGapsMs.push(Math.max(0, atMs - entry.lastNudgeAtMs))
    entry.lastNudgeAtMs = atMs
  }
  entry.firstWakeAtMs = entry.firstWakeAtMs ?? atMs
  entry.lastWakeAtMs = atMs
  entry.durationMsTotal += signal.durationMs
  entry.slotWaitMsTotal += signal.slotWaitMs
  entry.toolCalls += signal.toolCalls
  entry.candidates += signal.candidateCount
  entry.generations = Math.max(entry.generations, signal.generation)
  if (signal.usage !== undefined) {
    entry.inputTokens += signal.usage.input
    entry.outputTokens += signal.usage.output
    entry.cacheReadTokens += signal.usage.cacheRead
    entry.cacheWriteTokens += signal.usage.cacheWrite
  }
  if (signal.model !== undefined) entry.modelCounts.set(signal.model, (entry.modelCounts.get(signal.model) ?? 0) + 1)
}

function dominantModel(counts: ReadonlyMap<string, number>): string | undefined {
  let top: string | undefined
  let best = 0
  for (const [model, count] of counts) {
    if (count > best) {
      top = model
      best = count
    }
  }
  return top
}

export function createKibitzerTelemetryRegistry(): KibitzerTelemetryRegistry {
  const sessions = new Map<string, Accumulator>()

  function entryFor(sessionId: string): Accumulator {
    const existing = sessions.get(sessionId)
    if (existing !== undefined) return existing
    const created = emptyAccumulator()
    sessions.set(sessionId, created)
    return created
  }

  return {
    record: (signal, atMs) => {
      const entry = entryFor(signal.sessionId)
      if (signal.kind === "wake") {
        recordWake(entry, signal, atMs)
        return
      }
      entry.offers += 1
      if (signal.reason === "cooldown") entry.bufferedCooldown += 1
      if (signal.reason === "no_new_candidate") entry.bufferedNoNewCandidate += 1
    },
    snapshot: (sessionId) => {
      const entry = sessions.get(sessionId)
      if (entry === undefined) return undefined
      return {
        wakes: entry.wakes,
        wakesWithNudge: entry.wakesWithNudge,
        wakesFailed: entry.wakesFailed,
        wakesDeadline: entry.wakesDeadline,
        wakesToolBudget: entry.wakesToolBudget,
        offers: entry.offers,
        bufferedCooldown: entry.bufferedCooldown,
        bufferedNoNewCandidate: entry.bufferedNoNewCandidate,
        nudges: entry.nudges,
        firstNudgeWake: entry.firstNudgeWake,
        nudgeGapsMs: [...entry.nudgeGapsMs],
        wakeSpanMs: entry.firstWakeAtMs === undefined ? 0 : entry.lastWakeAtMs - entry.firstWakeAtMs,
        durationMsTotal: entry.durationMsTotal,
        slotWaitMsTotal: entry.slotWaitMsTotal,
        toolCalls: entry.toolCalls,
        candidates: entry.candidates,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheWriteTokens: entry.cacheWriteTokens,
        generations: entry.generations,
        modelTop: dominantModel(entry.modelCounts),
      }
    },
    clear: (sessionId) => {
      sessions.delete(sessionId)
    },
    size: () => sessions.size,
  }
}

/** Nearest-rank quantile: with two gaps the median is the smaller and p90 the larger, never an interpolation. */
function quantileMs(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.max(1, Math.ceil(fraction * sorted.length))
  return sorted[rank - 1] ?? 0
}

export function buildKibitzerSummary(
  snapshot: KibitzerSessionSnapshot,
  sessionHash: string,
): EventTelemetryProperties | undefined {
  if (snapshot.wakes === 0 && snapshot.offers === 0) return undefined
  const gaps = [...snapshot.nudgeGapsMs].sort((left, right) => left - right)
  return {
    $session_id: sessionHash,
    buffered_cooldown: snapshot.bufferedCooldown,
    buffered_no_new_candidate: snapshot.bufferedNoNewCandidate,
    cache_read_tokens: snapshot.cacheReadTokens,
    cache_write_tokens: snapshot.cacheWriteTokens,
    candidates_total: snapshot.candidates,
    first_nudge_wake: snapshot.firstNudgeWake,
    generations: snapshot.generations,
    input_tokens: snapshot.inputTokens,
    model_top: maskKibitzerModel(snapshot.modelTop),
    nudge_gap_ms_median: quantileMs(gaps, 0.5),
    nudge_gap_ms_p90: quantileMs(gaps, 0.9),
    nudges_delivered: snapshot.nudges,
    offers_total: snapshot.offers,
    output_tokens: snapshot.outputTokens,
    slot_wait_ms_total: snapshot.slotWaitMsTotal,
    tool_calls_total: snapshot.toolCalls,
    wake_duration_ms_total: snapshot.durationMsTotal,
    wake_span_ms: snapshot.wakeSpanMs,
    wakes_deadline: snapshot.wakesDeadline,
    wakes_failed: snapshot.wakesFailed,
    wakes_tool_budget: snapshot.wakesToolBudget,
    wakes_total: snapshot.wakes,
    wakes_with_nudge: snapshot.wakesWithNudge,
  }
}

export function registerOmoNativeKibitzerSummary(pi: SenpiExtensionAPI, options: OmoNativeKibitzerSummaryOptions): () => void {
  const registry = options.registry ?? createKibitzerTelemetryRegistry()
  const now = options.now ?? Date.now
  const subscribe = options.subscribe ?? sharedKibitzerTelemetryObservers().subscribe
  const unsubscribe = subscribe((signal) => registry.record(signal, now()))

  pi.on("session_shutdown", (_payload: unknown, eventContext: unknown): void => {
    const sessionId = extractSessionId(eventContext)
    if (sessionId === undefined) return
    const snapshot = registry.snapshot(sessionId)
    registry.clear(sessionId)
    if (snapshot === undefined) return
    const properties = buildKibitzerSummary(snapshot, options.hashSessionId(sessionId))
    if (properties === undefined) return
    options.captureEvent("kibitzer_summary", properties)
  })

  return unsubscribe
}

export function maskKibitzerModel(model: string | undefined): string {
  if (model === undefined || model.length === 0) return "none"
  const separator = model.indexOf("/")
  if (separator < 0) return maskProviderAndModel("custom", model).model_id
  return maskProviderAndModel(model.slice(0, separator), model.slice(separator + 1)).model_id
}

function extractSessionId(eventContext: unknown): string | undefined {
  if (eventContext === null || typeof eventContext !== "object") return undefined
  const manager = Reflect.get(eventContext, "sessionManager")
  if (manager === null || typeof manager !== "object") return undefined
  const getSessionId = Reflect.get(manager, "getSessionId")
  if (typeof getSessionId !== "function") return undefined
  const sessionId: unknown = Reflect.apply(getSessionId, manager, [])
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}
