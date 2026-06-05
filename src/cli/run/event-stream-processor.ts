import pc from "picocolors"
import type { RunContext, EventPayload } from "./types"
import type { EventState } from "./event-state"
import { logEventVerbose } from "./event-formatting"
import { eventHandlers } from "./event-handlers"

export async function processEvents(
  ctx: RunContext,
  stream: AsyncIterable<unknown>,
  state: EventState
): Promise<void> {
  for await (const event of stream) {
    if (ctx.abortController.signal.aborted) break

    try {
      const payload = event as EventPayload
      if (!payload?.type) {
        if (ctx.verbose) {
          console.error(pc.dim(`[event] no type: ${JSON.stringify(event)}`))
        }
        continue
      }

      if (ctx.verbose) {
        logEventVerbose(ctx, payload)
      }

      // Update last event timestamp for watchdog detection
      state.lastEventTimestamp = Date.now()

      for (const handler of eventHandlers) {
        handler(ctx, payload, state)
      }
    } catch (err) {
      console.error(pc.red(`[event error] ${err}`))
    }
  }
}
