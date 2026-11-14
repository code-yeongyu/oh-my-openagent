// Negative windows are pinned to measured latency: a "nothing happened" read is only trusted when the run waited at
// least 1.5 times the host's recorded p99 for the slowest planted action to show up in the recording.

const WINDOW_RATIO = 1.5

export type LatencyRecord = {
  readonly host: string
  readonly os: string
  readonly trials: number
  readonly p99Ms: Readonly<Record<string, number>>
}

type Admission = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export function p99(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(0.99 * sorted.length) - 1)] ?? Number.NaN
}

export function admitWindow(windowMs: number, record: LatencyRecord): Admission {
  const slowest = Object.entries(record.p99Ms).reduce<readonly [string, number] | undefined>(
    (worst, entry) => (worst === undefined || entry[1] > worst[1] ? entry : worst),
    undefined,
  )
  if (slowest === undefined)
    return { ok: false, reason: `no recorded latency on ${record.host}: calibrate before judging negatives` }
  const [action, latency] = slowest
  if (windowMs < WINDOW_RATIO * latency)
    return {
      ok: false,
      reason: `window ${windowMs} ms is below ${WINDOW_RATIO} x p99 ${latency} ms of ${action} on ${record.host}`,
    }
  return { ok: true }
}
