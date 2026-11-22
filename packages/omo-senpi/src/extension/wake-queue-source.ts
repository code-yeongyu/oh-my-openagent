import type { ComponentLogger, SenpiExtensionAPI } from "./types"

// senpi's wake-source event (senpi#3864): a live source of kind "children" keeps the session's lifecycle
// off "done". The idle-injection queue publishes the child results it holds or is delivering under it.
export const WAKE_QUEUE_STATE_EVENT = "wake_source_state"
export const WAKE_QUEUE_SOURCE = "omo-wake-queue"

interface WakeQueueEvents {
  readonly events?: { readonly emit: (name: string, data: unknown) => void }
}

/**
 * Publishing is a report, never part of delivery: a stale generation's event bus throws, and that must not
 * escape into the coordinator, where it would cost a delivery receipt (a lost completion). It is logged.
 */
export function publishWakeQueueChildWork(
  pi: WakeQueueEvents,
  logger?: Pick<ComponentLogger, "warn">,
): (count: number) => void {
  return (count) => {
    try {
      pi.events?.emit(WAKE_QUEUE_STATE_EVENT, { source: WAKE_QUEUE_SOURCE, kind: "children", activeCount: count })
    } catch (error) {
      logger?.warn("omo-wake-queue: could not publish the child work count", {
        count,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * senpi keeps wake-source counts across a reload, so each session generation publishes its own count at
 * session_start: a count the previous generation could no longer clear does not outlive it.
 */
export function publishWakeQueueBaselineOnSessionStart(
  pi: Pick<SenpiExtensionAPI, "on">,
  readCount: () => number,
  publish: (count: number) => void,
): void {
  pi.on("session_start", () => publish(readCount()))
}
