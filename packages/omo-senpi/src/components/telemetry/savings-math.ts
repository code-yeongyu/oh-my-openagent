/**
 * Savings are modeled against the wave span, never against `max(duration)`.
 * Overlap-based waves do not guarantee a simultaneous start, so a chained wave
 * (A 0-5, B 4-9, C 8-12) elapses 12ms in reality: the span formula reports 2ms
 * saved while the `max` variant reports 9ms, a 4.5x overstatement. A truly
 * simultaneous batch has `spanMs == max(duration)`, so honest batches keep their
 * numbers unchanged.
 *
 * `(N - 1) * mean(duration)` is an upper bound, not a measurement, and is exposed
 * only through `upperBoundSavedMs`. The two results carry distinct literal labels
 * so a caller cannot pass one where the other is expected without a visible cast.
 *
 * Round trips saved follow `maxConcurrency`, not the wave size: a chained wave has
 * three calls but never runs more than two at once, so it saves one round trip.
 *
 * Negative results are never clamped. A span wider than the summed durations means
 * the observations disagree with each other, and hiding it would hide the anomaly.
 */

export type MeasurableCall = {
  readonly startMs: number
  readonly endMs: number
}

export type MeasurableWave = {
  readonly calls: readonly MeasurableCall[]
  readonly spanMs: number
  readonly maxConcurrency: number
}

export type ModeledSavedMs = {
  readonly label: "modeled"
  readonly valueMs: number
}

export type UpperBoundSavedMs = {
  readonly label: "upper_bound"
  readonly valueMs: number
}

export function modeledWallClockSavedMs(wave: MeasurableWave): ModeledSavedMs {
  const durations = usableDurations(wave.calls)
  if (durations.length <= 1 || !Number.isFinite(wave.spanMs)) {
    return { label: "modeled", valueMs: 0 }
  }
  return { label: "modeled", valueMs: sum(durations) - wave.spanMs }
}

export function upperBoundSavedMs(wave: MeasurableWave): UpperBoundSavedMs {
  const durations = usableDurations(wave.calls)
  if (durations.length <= 1) return { label: "upper_bound", valueMs: 0 }
  const mean = sum(durations) / durations.length
  return { label: "upper_bound", valueMs: (durations.length - 1) * mean }
}

export function savedRoundTrips(waves: readonly MeasurableWave[]): number {
  let total = 0
  for (const wave of waves) {
    if (!Number.isFinite(wave.maxConcurrency)) continue
    total += Math.max(wave.maxConcurrency - 1, 0)
  }
  return total
}

/**
 * A call contributes a duration only when both timestamps are finite and ordered.
 * Reversed or non-finite intervals are dropped here so no NaN or Infinity can
 * reach a reported metric.
 */
function usableDurations(calls: readonly MeasurableCall[]): readonly number[] {
  const durations: number[] = []
  for (const call of calls) {
    if (!Number.isFinite(call.startMs) || !Number.isFinite(call.endMs)) continue
    if (call.endMs < call.startMs) continue
    durations.push(call.endMs - call.startMs)
  }
  return durations
}

function sum(values: readonly number[]): number {
  let total = 0
  for (const value of values) total += value
  return total
}
