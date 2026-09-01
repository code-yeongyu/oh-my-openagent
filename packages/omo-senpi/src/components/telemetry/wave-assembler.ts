/**
 * Concurrency waves are interval-graph connected components, not turns.
 * A call joins a wave when its [startMs, endMs] interval overlaps any call already
 * in that wave, so chained executions (A overlaps B, B overlaps C, A misses C) stay
 * one wave. Each wave therefore reports `spanMs = maxEnd - minStart` rather than the
 * longest single duration: the savings formula downstream needs the real elapsed
 * window, and `max(duration)` overstates it on chained waves.
 *
 * Resident per-call detail lives in two places while a session runs: starts awaiting
 * their end, and completed pairs. `MAX_TRACKED_CALLS` bounds their sum, so a fully
 * parallel batch that emits every start before any end is capped the same as an
 * interleaved one. Gating on completed pairs alone would leave the pending map
 * unbounded for exactly the concurrent shape this telemetry exists to measure.
 */

export const MAX_TRACKED_CALLS = 2000

export type ToolExecutionObservation = {
  readonly kind: "start" | "end"
  readonly toolCallId: string
  readonly toolName: string
  readonly atMs: number
}

export type PairedToolCall = {
  readonly toolCallId: string
  readonly toolName: string
  readonly startMs: number
  readonly endMs: number
}

export type ConcurrencyWave = {
  readonly calls: readonly PairedToolCall[]
  readonly spanMs: number
  readonly maxConcurrency: number
}

export type WaveCounters = {
  readonly observedCalls: number
  readonly pairedCalls: number
  readonly incomplete: number
  readonly clockAnomalies: number
  readonly droppedCalls: number
  readonly malformed: number
}

export type WaveAssembly = {
  readonly waves: readonly ConcurrencyWave[]
  readonly counters: WaveCounters
}

type MutableCounters = { -readonly [Key in keyof WaveCounters]: WaveCounters[Key] }
type PendingStart = { readonly toolName: string; readonly startMs: number }

export function assembleWaves(observations: readonly ToolExecutionObservation[]): WaveAssembly {
  const counters: MutableCounters = {
    observedCalls: 0,
    pairedCalls: 0,
    incomplete: 0,
    clockAnomalies: 0,
    droppedCalls: 0,
    malformed: 0,
  }
  const pending = new Map<string, PendingStart>()
  const paired: PairedToolCall[] = []

  for (const candidate of observations) {
    const observation = parseObservation(candidate)
    if (observation === undefined) {
      counters.malformed += 1
      continue
    }
    if (observation.kind === "start") {
      counters.observedCalls += 1
      if (paired.length + pending.size >= MAX_TRACKED_CALLS) {
        counters.droppedCalls += 1
        continue
      }
      pending.set(observation.toolCallId, { toolName: observation.toolName, startMs: observation.atMs })
      continue
    }
    const started = pending.get(observation.toolCallId)
    if (started === undefined) continue
    pending.delete(observation.toolCallId)
    if (observation.atMs < started.startMs) {
      counters.clockAnomalies += 1
      continue
    }
    counters.pairedCalls += 1
    paired.push({
      toolCallId: observation.toolCallId,
      toolName: started.toolName,
      startMs: started.startMs,
      endMs: observation.atMs,
    })
  }

  counters.incomplete = pending.size
  return { waves: groupIntoWaves(paired), counters }
}

function groupIntoWaves(calls: readonly PairedToolCall[]): readonly ConcurrencyWave[] {
  const ordered = [...calls].sort(byStartThenEnd)
  const waves: ConcurrencyWave[] = []
  let current: PairedToolCall[] = []
  let reach = Number.NEGATIVE_INFINITY

  for (const call of ordered) {
    if (current.length > 0 && call.startMs > reach) {
      waves.push(buildWave(current))
      current = []
      reach = Number.NEGATIVE_INFINITY
    }
    current.push(call)
    reach = Math.max(reach, call.endMs)
  }
  if (current.length > 0) waves.push(buildWave(current))
  return waves
}

function buildWave(calls: readonly PairedToolCall[]): ConcurrencyWave {
  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = Number.NEGATIVE_INFINITY
  for (const call of calls) {
    minStart = Math.min(minStart, call.startMs)
    maxEnd = Math.max(maxEnd, call.endMs)
  }
  return {
    calls: [...calls],
    spanMs: maxEnd - minStart,
    maxConcurrency: sweepMaxConcurrency(calls),
  }
}

/**
 * Ends are applied before starts at an identical timestamp, so a call that finishes
 * exactly when the next one begins is never counted as two concurrent executions.
 */
function sweepMaxConcurrency(calls: readonly PairedToolCall[]): number {
  const boundaries: { atMs: number; delta: number }[] = []
  for (const call of calls) {
    boundaries.push({ atMs: call.startMs, delta: 1 })
    boundaries.push({ atMs: call.endMs, delta: -1 })
  }
  boundaries.sort((left, right) => left.atMs - right.atMs || left.delta - right.delta)

  let active = 0
  let peak = 0
  for (const boundary of boundaries) {
    active += boundary.delta
    peak = Math.max(peak, active)
  }
  return peak
}

function byStartThenEnd(left: PairedToolCall, right: PairedToolCall): number {
  return left.startMs - right.startMs || left.endMs - right.endMs
}

function parseObservation(value: unknown): ToolExecutionObservation | undefined {
  if (!isRecord(value)) return undefined
  const kind = value["kind"]
  const toolCallId = value["toolCallId"]
  const toolName = value["toolName"]
  const atMs = value["atMs"]
  if (kind !== "start" && kind !== "end") return undefined
  if (typeof toolCallId !== "string" || toolCallId.length === 0) return undefined
  if (typeof toolName !== "string" || toolName.length === 0) return undefined
  if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0) return undefined
  return { kind, toolCallId, toolName, atMs }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
