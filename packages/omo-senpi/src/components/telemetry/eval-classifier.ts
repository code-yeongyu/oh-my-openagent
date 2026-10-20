/**
 * Eval waves are isolated into their own buckets instead of being filtered out.
 * Dropping the eval call from a mixed wave and recomputing the remainder shrinks
 * the wave span and inflates apparent savings (measured: 1.20s reported as 0.70s),
 * so `mixed` waves are recorded separately and never folded into `non_eval`.
 */

export type WaveBucket = "eval_only" | "non_eval" | "mixed"

export type ClassifiableWave = {
  readonly toolNames: readonly string[]
  readonly spanMs: number
}

/** Non-eval waves counted by size: 1, 2-3, 4-7 and 8 or more calls. */
export type WaveSizeBuckets = {
  readonly size1: number
  readonly size2to3: number
  readonly size4to7: number
  readonly size8plus: number
}

export type NonEvalWaveCounters = {
  readonly wavesTotal: number
  readonly wavesMulti: number
  readonly joinedCalls: number
  readonly waveSizeBuckets: WaveSizeBuckets
}

export type WaveBucketSummary = {
  readonly nonEval: NonEvalWaveCounters
  readonly evalOnlyWaves: number
  readonly evalOnlyDurationMs: number
  readonly mixedWaves: number
  readonly evalOuterJoinedCalls: number
  readonly mixedNonEvalJoinedCalls: number
}

const EVAL_TOOL_NAMES = ["eval", "codemode", "code_mode"] as const

export function isEvalToolName(toolName: string): boolean {
  return EVAL_TOOL_NAMES.some((expected) => matchesToolName(toolName, expected))
}

export function classifyWaveBucket(wave: ClassifiableWave): WaveBucket {
  let evalCalls = 0
  let nonEvalCalls = 0
  for (const toolName of wave.toolNames) {
    if (isEvalToolName(toolName)) evalCalls += 1
    else nonEvalCalls += 1
  }
  if (evalCalls === 0) return "non_eval"
  return nonEvalCalls === 0 ? "eval_only" : "mixed"
}

export function summarizeWaveBuckets(waves: readonly ClassifiableWave[]): WaveBucketSummary {
  const sizes = { size1: 0, size2to3: 0, size4to7: 0, size8plus: 0 }
  let wavesTotal = 0
  let wavesMulti = 0
  let joinedCalls = 0
  let evalOnlyWaves = 0
  let evalOnlyDurationMs = 0
  let mixedWaves = 0
  let evalOuterJoinedCalls = 0
  let mixedNonEvalJoinedCalls = 0

  for (const wave of waves) {
    const bucket = classifyWaveBucket(wave)
    if (bucket === "eval_only") {
      evalOnlyWaves += 1
      evalOnlyDurationMs += durationOf(wave)
      evalOuterJoinedCalls += wave.toolNames.length
      continue
    }
    if (bucket === "mixed") {
      mixedWaves += 1
      for (const toolName of wave.toolNames) {
        if (isEvalToolName(toolName)) evalOuterJoinedCalls += 1
        else mixedNonEvalJoinedCalls += 1
      }
      continue
    }
    const size = wave.toolNames.length
    wavesTotal += 1
    joinedCalls += size
    if (size > 1) wavesMulti += 1
    if (size > 0) sizes[waveSizeBucket(size)] += 1
  }

  return {
    nonEval: {
      wavesTotal,
      wavesMulti,
      joinedCalls,
      waveSizeBuckets: sizes,
    },
    evalOnlyWaves,
    evalOnlyDurationMs,
    mixedWaves,
    evalOuterJoinedCalls,
    mixedNonEvalJoinedCalls,
  }
}

function waveSizeBucket(size: number): keyof WaveSizeBuckets {
  if (size <= 1) return "size1"
  if (size <= 3) return "size2to3"
  if (size <= 7) return "size4to7"
  return "size8plus"
}

function durationOf(wave: ClassifiableWave): number {
  return Number.isFinite(wave.spanMs) ? wave.spanMs : 0
}

function matchesToolName(toolName: string, expected: string): boolean {
  const normalized = normalizeToolName(toolName)
  const suffix = normalizeToolName(expected)
  return normalized === suffix || normalized.endsWith(`_${suffix}`) || normalized.endsWith(`:${suffix}`) || normalized.endsWith(`/${suffix}`)
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase().replaceAll("-", "_")
}
