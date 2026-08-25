/**
 * `parallelism_summary` is emitted exactly once per session, at `session_shutdown`.
 *
 * Registration order is load-bearing and is therefore owned here rather than left to the
 * caller. Two other handlers destroy what this emission needs: the wrapped transport in
 * `omo-native-component.ts` clears `state.capture` once the session client shuts down, so a
 * later capture is a silent no-op, and `registerOmoNativeParallelTelemetry`'s own handler
 * clears the session registry, so a later `snapshot()` returns `undefined`. Sharing the
 * registry object does not help: it shares state, not ordering. `registerOmoNativeParallelSummary`
 * therefore registers its `session_shutdown` handler and only then registers the subscriber,
 * and the caller must invoke it before the session component. `omo-native-component.test.ts`
 * pins that order by driving the real component and asserting a non-empty payload.
 *
 * Emitting on `turn_end` or `agent_settled` instead would be order-independent but cannot
 * satisfy the once-per-session volume bound: neither event knows it is the last one, so the
 * choice is between emitting per turn (volume blowup, explicitly forbidden) and emitting on the
 * first turn only (silently dropping every later turn's waves).
 *
 * The snapshot is consumed once and the session is cleared immediately, so a second shutdown
 * for the same session emits nothing and two sessions can never mix.
 */

import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import { classifyWaveBucket, summarizeWaveBuckets, type ClassifiableWave } from "./eval-classifier"
import {
  createParallelTelemetryRegistry,
  registerOmoNativeParallelTelemetry,
  type OmoNativeParallelTelemetryOptions,
  type ParallelSessionSnapshot,
} from "./omo-native-parallel"
import { modeledWallClockSavedMs, savedRoundTrips, upperBoundSavedMs } from "./savings-math"
import type { ConcurrencyWave } from "./wave-assembler"

export type OmoNativeParallelSummaryOptions = OmoNativeParallelTelemetryOptions & {
  readonly captureEvent: (name: "parallelism_summary", properties: EventTelemetryProperties) => void
  readonly hashSessionId: (rawId: string) => string
}

export function registerOmoNativeParallelSummary(
  pi: SenpiExtensionAPI,
  options: OmoNativeParallelSummaryOptions,
): void {
  const { captureEvent, hashSessionId, ...telemetryOptions } = options
  const registry = telemetryOptions.registry ?? createParallelTelemetryRegistry()

  pi.on("session_shutdown", (_payload: unknown, eventContext: unknown): void => {
    const sessionId = extractSessionId(eventContext)
    if (sessionId === undefined) return
    const snapshot = registry.snapshot(sessionId)
    registry.clear(sessionId)
    if (snapshot === undefined) return
    const properties = buildParallelismSummary(snapshot, hashSessionId(sessionId))
    if (properties === undefined) return
    captureEvent("parallelism_summary", properties)
  })

  registerOmoNativeParallelTelemetry(pi, { ...telemetryOptions, registry })
}

/**
 * Returns `undefined` when the session produced nothing worth reporting, so an idle session
 * never spends an event. Quality counters alone do not justify an emission: a session whose
 * only tool calls were incomplete or clock-anomalous carries no parallelism signal.
 */
export function buildParallelismSummary(
  snapshot: ParallelSessionSnapshot,
  sessionHash: string,
): EventTelemetryProperties | undefined {
  const classifiable: ClassifiableWave[] = []
  // Savings are summed over the `non_eval` bucket alone. Including a `mixed` wave here would let an
  // eval call's span inflate the reported saving, which is why `mixed` keeps its own counter only.
  const nonEvalWaves: ConcurrencyWave[] = []
  for (const wave of snapshot.assembly.waves) {
    const projected = toClassifiableWave(wave)
    classifiable.push(projected)
    if (classifyWaveBucket(projected) === "non_eval") nonEvalWaves.push(wave)
  }

  const buckets = summarizeWaveBuckets(classifiable)
  if (
    buckets.nonEval.wavesTotal === 0
    && buckets.evalOnlyWaves === 0
    && buckets.mixedWaves === 0
    && snapshot.evalExecution.eventCount === 0
  ) {
    return undefined
  }
  const counters = snapshot.assembly.counters
  const evalExecution = snapshot.evalExecution
  return {
    $session_id: sessionHash,
    clock_anomalies: counters.clockAnomalies,
    dropped_calls: counters.droppedCalls,
    eval_execution_detached_count: evalExecution.detachedCount,
    eval_execution_event_bus_available: snapshot.evalExecutionEventBusAvailable,
    eval_execution_event_count: evalExecution.eventCount,
    eval_execution_event_rejected_count: evalExecution.rejectedCount,
    eval_execution_ok_count: evalExecution.okCount,
    eval_cells_with_nested_count: snapshot.evalCellsWithNestedCount,
    eval_saved_prefix_tokens: (evalExecution.nestedToolCallCount - snapshot.evalCellsWithNestedCount) * snapshot.currentPrefixTokens,
    eval_nested_tool_call_count: evalExecution.nestedToolCallCount,
    eval_nested_tool_call_error_count: evalExecution.nestedToolCallErrorCount,
    eval_nested_tool_call_ok_count: evalExecution.nestedToolCallOkCount,
    eval_nested_tool_call_pending_count: evalExecution.nestedToolCallPendingCount,
    eval_only_duration_ms: buckets.evalOnlyDurationMs,
    eval_only_waves: buckets.evalOnlyWaves,
    eval_outer_joined_calls: buckets.evalOuterJoinedCalls,
    eval_tool_aggregate_truncated_execution_count: evalExecution.truncatedExecutionCount,
    incomplete_calls: counters.incomplete,
    measured_eval_execution_duration_ms_sum: evalExecution.measuredExecutionDurationMsSum,
    measured_eval_nested_tool_duration_ms_sum: evalExecution.measuredNestedToolDurationMsSum,
    measured_turn_duration_ms_total: snapshot.measuredTurnDurationMsTotal,
    mixed_non_eval_joined_calls: buckets.mixedNonEvalJoinedCalls,
    mixed_waves: buckets.mixedWaves,
    modeled_wallclock_saved_ms: sumBy(nonEvalWaves, (wave) => modeledWallClockSavedMs(wave).valueMs),
    non_eval_joined_calls: buckets.nonEval.joinedCalls,
    non_eval_saved_prefix_tokens: sumBy(nonEvalWaves, (wave) => (wave.maxConcurrency - 1) * snapshot.currentPrefixTokens),
    non_eval_saved_round_trips: savedRoundTrips(nonEvalWaves),
    non_eval_wave_size_histogram: buckets.nonEval.waveSizeHistogram,
    non_eval_waves_multi: buckets.nonEval.wavesMulti,
    non_eval_waves_total: buckets.nonEval.wavesTotal,
    schema_kind: "parallelism_v3",
    current_prefix_tokens: snapshot.currentPrefixTokens,
    upper_bound_saved_ms: sumBy(nonEvalWaves, (wave) => upperBoundSavedMs(wave).valueMs),
  }
}

/**
 * The assembler reports calls, the classifier consumes tool names. Mapping here keeps the two
 * modules independent and keeps a second copy of the observations out of memory: the projection
 * is per-wave and transient, never retained.
 */
function toClassifiableWave(wave: ConcurrencyWave): ClassifiableWave {
  return { toolNames: wave.calls.map((call) => call.toolName), spanMs: wave.spanMs }
}

function sumBy(waves: readonly ConcurrencyWave[], value: (wave: ConcurrencyWave) => number): number {
  let total = 0
  for (const wave of waves) total += value(wave)
  return total
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
