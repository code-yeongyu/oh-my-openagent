import type { SentinelEvent } from "./events.ts"

// 20 Hz is a 50 ms period; five missed periods in a row means the sampler stalled.
const MAX_TICK_GAP_MS = 250

export function samplerGapFault(ordered: readonly SentinelEvent[], start: number, stop: number): string | undefined {
  const ticks = ordered.flatMap((event) =>
    event.kind === "tick" && event.t >= start && event.t <= stop ? [event.t] : [],
  )
  const stamps = [start, ...ticks, stop]
  const gap = Math.max(...stamps.slice(1).map((t, index) => t - (stamps[index] ?? t)))
  return gap > MAX_TICK_GAP_MS ? `sampler: no tick for ${gap} ms (20 Hz expected)` : undefined
}
