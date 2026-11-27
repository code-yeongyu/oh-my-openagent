import type { SentinelEvent } from "./events.ts"

// 20 Hz is a 50 ms period; five missed periods in a row means the sampler stalled.
const MAX_TICK_GAP_MS = 250

type SlowTick = Extract<SentinelEvent, { readonly kind: "slow_tick" }>

// The recorder emits a tick as a sample begins and a slow_tick as a slow sample ends, so the slow_tick of a sample
// that held the sampler lands inside the gap it caused.
function heldBy(ordered: readonly SentinelEvent[], from: number, to: number): string {
  const slowest = ordered
    .filter((event): event is SlowTick => event.kind === "slow_tick" && event.t > from && event.t <= to)
    .reduce<SlowTick | undefined>(
      (best, event) => (best === undefined || event.readMs > best.readMs ? event : best),
      undefined,
    )
  return slowest === undefined
    ? "no sampler read was slow in it, so the recorder's main thread was busy elsewhere"
    : `slowest sampler read in it: ${slowest.read} ${slowest.readMs} ms`
}

export function samplerGapFault(ordered: readonly SentinelEvent[], start: number, stop: number): string | undefined {
  const ticks = ordered.flatMap((event) =>
    event.kind === "tick" && event.t >= start && event.t <= stop ? [event.t] : [],
  )
  const stamps = [start, ...ticks, stop]
  let gap = { ms: 0, from: start, to: start }
  stamps.slice(1).forEach((t, index) => {
    const before = stamps[index] ?? t
    if (t - before > gap.ms) gap = { ms: t - before, from: before, to: t }
  })
  if (gap.ms <= MAX_TICK_GAP_MS) return undefined
  return `sampler: no tick for ${gap.ms} ms (20 Hz expected; ${heldBy(ordered, gap.from, gap.to)})`
}
