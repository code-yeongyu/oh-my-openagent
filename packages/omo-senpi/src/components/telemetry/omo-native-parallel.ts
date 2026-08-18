/**
 * Senpi tool-execution events carry no timestamp: `ToolExecutionStartEvent` is
 * `{type, toolCallId, toolName, args}` and `ToolExecutionEndEvent` is
 * `{type, toolCallId, toolName, result, isError}`. This subscriber therefore stamps the
 * arrival time itself, at the first statement of each handler, from an injected clock.
 * Consequence to keep in mind when reading the numbers: every span inherits handler-entry
 * skew (dispatch queueing plus handler entry on both edges), so a call's measured duration
 * is the observed window between two handler entries, not the tool's internal runtime.
 * Turn boundaries are asymmetric for the same reason: `turn_start` does carry `timestamp`
 * and is trusted as-is, while `turn_end` does not and is stamped on arrival.
 *
 * Observations are buffered per session and funnelled through exactly one `assembleWaves`
 * call at snapshot time, because `MAX_TRACKED_CALLS` bounds a single assembly call rather
 * than the process: assembling incrementally would reset the cap on every call and defeat it.
 *
 * Only a `start` observation may open per-session state. A stray `end` or `turn_end` arriving
 * after `session_shutdown` would otherwise resurrect an entry that no later shutdown clears,
 * and its `start` is already gone, so the observation carries no information anyway.
 */

import type { SenpiExtensionAPI } from "../../extension/types"
import { createEvalCellCorrelation } from "./eval-cell-correlation"
import { isEvalToolName } from "./eval-classifier"
import {
  addEvalExecutionRollup,
  EMPTY_EVAL_EXECUTION_ROLLUP,
  parseEvalExecutionEvent,
  REJECTED_EVAL_EXECUTION_ROLLUP,
  SENPI_EVAL_EXECUTION_EVENT,
  type EvalExecutionRollup,
} from "./omo-native-eval"
import { assembleWaves, type ToolExecutionObservation, type WaveAssembly } from "./wave-assembler"

export type ParallelSessionSnapshot = {
  readonly assembly: WaveAssembly
  readonly evalExecution: EvalExecutionRollup
  readonly evalExecutionEventBusAvailable: boolean
  readonly measuredTurnDurationMsTotal: number
}

export type ParallelTelemetryRegistry = {
  readonly record: (sessionId: string, observation: ToolExecutionObservation) => void
  readonly recordEvalExecution: (payload: unknown) => void
  readonly setEvalExecutionEventBusAvailable: (available: boolean) => void
  readonly startTurn: (sessionId: string, atMs: number) => void
  readonly endTurn: (sessionId: string, atMs: number) => void
  readonly snapshot: (sessionId: string) => ParallelSessionSnapshot | undefined
  readonly clear: (sessionId: string) => void
  readonly size: () => number
}

export type OmoNativeParallelTelemetryOptions = {
  readonly now?: () => number
  readonly registry?: ParallelTelemetryRegistry
}

type SessionState = {
  evalExecution: EvalExecutionRollup
  observations: ToolExecutionObservation[]
  turnStartMs: number | undefined
  measuredTurnDurationMsTotal: number
}

export function createParallelTelemetryRegistry(): ParallelTelemetryRegistry {
  const sessions = new Map<string, SessionState>()
  const evalCells = createEvalCellCorrelation()
  let evalExecutionEventBusAvailable = false

  const ensure = (sessionId: string): SessionState => {
    const existing = sessions.get(sessionId)
    if (existing !== undefined) return existing
    const created: SessionState = {
      evalExecution: EMPTY_EVAL_EXECUTION_ROLLUP,
      observations: [],
      turnStartMs: undefined,
      measuredTurnDurationMsTotal: 0,
    }
    sessions.set(sessionId, created)
    return created
  }

  const clearSession = (sessionId: string): void => {
    sessions.delete(sessionId)
    evalCells.clearSession(sessionId)
  }

  return {
    record: (sessionId, observation) => {
      const state = observation.kind === "start" ? ensure(sessionId) : sessions.get(sessionId)
      state?.observations.push(observation)
      if (observation.kind === "start" && isEvalToolName(observation.toolName)) {
        evalCells.track(sessionId, observation.toolCallId)
      }
    },
    recordEvalExecution: (payload) => {
      const parsed = parseEvalExecutionEvent(payload)
      if (parsed.kind === "ignored") return
      const sessionId = evalCells.consume(parsed.cellId)
      if (sessionId === undefined) return
      const state = sessions.get(sessionId)
      if (state === undefined) return
      state.evalExecution = addEvalExecutionRollup(
        state.evalExecution,
        parsed.kind === "accepted" ? parsed.rollup : REJECTED_EVAL_EXECUTION_ROLLUP,
      )
    },
    setEvalExecutionEventBusAvailable: (available) => {
      evalExecutionEventBusAvailable = available
    },
    startTurn: (sessionId, atMs) => {
      ensure(sessionId).turnStartMs = atMs
    },
    endTurn: (sessionId, atMs) => {
      const state = sessions.get(sessionId)
      if (state === undefined) return
      if (state.turnStartMs === undefined) return
      const elapsed = atMs - state.turnStartMs
      state.turnStartMs = undefined
      if (elapsed <= 0) return
      state.measuredTurnDurationMsTotal += elapsed
    },
    snapshot: (sessionId) => {
      const state = sessions.get(sessionId)
      if (state === undefined) return undefined
      return {
        assembly: assembleWaves(state.observations),
        evalExecution: state.evalExecution,
        evalExecutionEventBusAvailable,
        measuredTurnDurationMsTotal: state.measuredTurnDurationMsTotal,
      }
    },
    clear: clearSession,
    size: () => sessions.size,
  }
}

export function registerOmoNativeParallelTelemetry(
  pi: SenpiExtensionAPI,
  options: OmoNativeParallelTelemetryOptions = {},
): ParallelTelemetryRegistry {
  const now = options.now ?? Date.now
  const registry = options.registry ?? createParallelTelemetryRegistry()
  const eventBusAvailable = pi.events !== undefined
  registry.setEvalExecutionEventBusAvailable(eventBusAvailable)
  pi.events?.on(SENPI_EVAL_EXECUTION_EVENT, (payload) => registry.recordEvalExecution(payload))

  pi.on("tool_execution_start", (payload: unknown, eventContext: unknown): void => {
    const atMs = now()
    recordExecution(registry, "start", "tool_execution_start", payload, eventContext, atMs)
  })

  pi.on("tool_execution_end", (payload: unknown, eventContext: unknown): void => {
    const atMs = now()
    recordExecution(registry, "end", "tool_execution_end", payload, eventContext, atMs)
  })

  pi.on("turn_start", (payload: unknown, eventContext: unknown): void => {
    const startedAtMs = turnStartTimestamp(payload)
    if (startedAtMs === undefined) return
    const sessionId = extractSessionId(eventContext)
    if (sessionId === undefined) return
    registry.startTurn(sessionId, startedAtMs)
  })

  pi.on("turn_end", (payload: unknown, eventContext: unknown): void => {
    const atMs = now()
    if (!isEventOfType(payload, "turn_end")) return
    const sessionId = extractSessionId(eventContext)
    if (sessionId === undefined) return
    registry.endTurn(sessionId, atMs)
  })

  pi.on("session_shutdown", (_payload: unknown, eventContext: unknown): void => {
    const sessionId = extractSessionId(eventContext)
    if (sessionId === undefined) return
    registry.clear(sessionId)
  })

  return registry
}

function recordExecution(
  registry: ParallelTelemetryRegistry,
  kind: ToolExecutionObservation["kind"],
  expectedType: string,
  payload: unknown,
  eventContext: unknown,
  atMs: number,
): void {
  const identity = toolExecutionIdentity(payload, expectedType)
  if (identity === undefined) return
  const sessionId = extractSessionId(eventContext)
  if (sessionId === undefined) return
  registry.record(sessionId, { kind, toolCallId: identity.toolCallId, toolName: identity.toolName, atMs })
}

function toolExecutionIdentity(
  value: unknown,
  expectedType: string,
): { readonly toolCallId: string; readonly toolName: string } | undefined {
  if (!isEventOfType(value, expectedType)) return undefined
  const toolCallId = value["toolCallId"]
  const toolName = value["toolName"]
  if (typeof toolCallId !== "string" || toolCallId.length === 0) return undefined
  if (typeof toolName !== "string" || toolName.length === 0) return undefined
  return { toolCallId, toolName }
}

function turnStartTimestamp(value: unknown): number | undefined {
  if (!isEventOfType(value, "turn_start")) return undefined
  const timestamp = value["timestamp"]
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0) return undefined
  return timestamp
}

function isEventOfType(value: unknown, expectedType: string): value is Record<string, unknown> {
  return isRecord(value) && value["type"] === expectedType
}

function extractSessionId(eventContext: unknown): string | undefined {
  if (!isRecord(eventContext) || !isRecord(eventContext["sessionManager"])) return undefined
  const manager = eventContext["sessionManager"]
  const getSessionId = manager["getSessionId"]
  if (typeof getSessionId !== "function") return undefined
  const sessionId: unknown = getSessionId.call(manager)
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
