import type { Scheduler } from "./scheduler.ts"

const HEARTBEAT_INTERVAL_MS = 500
/** A brain link silent this long is stale: reads only, holds released (d-remote.md 'Latency and budgets'). */
const BRAIN_LINK_STALE_MS = 15_000

/**
 * The 500 ms `stopPath.heartbeat` to the engine, sent only while the brain link is fresh. When the
 * brain goes silent the heartbeat stops, so the engine's host-relay stop path goes stale and it
 * refuses exec on its own; heartbeats resume once the brain is heard again.
 */
export function startHeartbeat(deps: {
  readonly scheduler: Scheduler
  readonly send: () => void
  readonly brainLastSeenMs: () => number
}): () => void {
  return deps.scheduler.every(HEARTBEAT_INTERVAL_MS, () => {
    if (deps.scheduler.now() - deps.brainLastSeenMs() < BRAIN_LINK_STALE_MS) deps.send()
  })
}
