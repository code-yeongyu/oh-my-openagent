import type { Hooks } from "@opencode-ai/plugin"
import type { V2Event, V2PluginContext } from "../context-types"
import type { SessionTracker } from "../session-tracker"
import { toV1Events } from "./translate-events"

type EventHook = NonNullable<Hooks["event"]>
type HookEvent = Parameters<EventHook>[0]["event"]

export type EventBridge = {
  /** Sets (or clears) the V1 `event` hook; events before this is set only update the tracker. */
  readonly setHandler: (handler: EventHook | undefined) => void
  readonly stop: () => void
}

export type EventBridgeDeps = {
  readonly tracker: SessionTracker
  readonly warn: (message: string) => void
  /** First wait before resubscribing after the stream breaks; doubles up to MAX_RETRY_DELAY_MS. */
  readonly retryDelayMs?: number
}

const DEFAULT_RETRY_DELAY_MS = 100
const MAX_RETRY_DELAY_MS = 2_000

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/**
 * Subscribes to the 2.x event stream. Each event updates the tracker immediately, then its 1.x
 * equivalents are queued for the V1 `event` hook and delivered in order, one at a time, so a slow
 * or failing hook never delays the tracker or drops later events.
 *
 * The host can break the stream (it has thrown "Expected JSON value" mid-run) and the events in
 * flight are lost. The bridge resubscribes with a short backoff, and each time it does it checks
 * the sessions it believed busy: one whose log now ends in an `idle` entry finished while the
 * stream was down, so its missed end event is replayed from that entry.
 */
export function startEventBridge(context: V2PluginContext, deps: EventBridgeDeps): EventBridge {
  const abort = new AbortController()
  let handler: EventHook | undefined
  let queue: Promise<void> = Promise.resolve()

  const dispatch = (event: HookEvent): void => {
    queue = queue.then(async () => {
      const current = handler
      if (current === undefined) return
      try {
        await current({ event })
      } catch (error) {
        deps.warn(`event hook failed on ${event.type}: ${messageOf(error)}`)
      }
    })
  }

  const handle = (event: V2Event): void => {
    const translated = toV1Events(event, deps.tracker)
    deps.tracker.observe(event)
    for (const v1 of translated) dispatch(v1 as HookEvent)
  }

  const reconcile = async (): Promise<void> => {
    for (const sessionID of Object.keys(deps.tracker.statuses())) {
      try {
        const log = await context.session.context({ sessionID })
        const last = log[log.length - 1]
        if (last?.type !== "idle" || abort.signal.aborted) continue
        const outcome = last.outcome ?? "succeeded"
        handle({
          type: `session.execution.${outcome}`,
          data: { sessionID, ...(outcome === "failed" ? { error: last.error } : {}), ...(outcome === "interrupted" ? { reason: "user" } : {}) },
        })
      } catch (error) {
        deps.warn(`could not check session ${sessionID} after the event stream broke: ${messageOf(error)}`)
      }
    }
  }

  void (async () => {
    let failures = 0
    let wasBroken = false
    while (!abort.signal.aborted) {
      try {
        if (wasBroken) void reconcile()
        for await (const event of context.event.subscribe({ signal: abort.signal })) {
          failures = 0
          handle(event)
        }
      } catch (error) {
        if (abort.signal.aborted) break
        deps.warn(`event subscription failed: ${messageOf(error)}`)
      }
      if (abort.signal.aborted) break
      wasBroken = true
      failures += 1
      await sleep(Math.min((deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * 2 ** (failures - 1), MAX_RETRY_DELAY_MS), abort.signal)
    }
  })()

  return {
    setHandler: (next) => {
      handler = next
    },
    stop: () => {
      abort.abort()
      handler = undefined
    },
  }
}
