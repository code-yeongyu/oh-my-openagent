import pc from "picocolors"
import type { RunContext, EventPayload } from "./types"
import type { EventState } from "./event-state"
import { logEventVerbose } from "./event-formatting"
import {
  handleSessionError,
  handleSessionIdle,
  handleSessionStatus,
  handleMessagePartUpdated,
  handleMessagePartDelta,
  handleMessageUpdated,
  handleToolExecute,
  handleToolResult,
  handleTuiToast,
} from "./event-handlers"

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

      handleSessionError(ctx, payload, state)
      handleSessionIdle(ctx, payload, state)
      handleSessionStatus(ctx, payload, state)
      handleMessagePartUpdated(ctx, payload, state)
      handleMessagePartDelta(ctx, payload, state)
      handleMessageUpdated(ctx, payload, state)
      handleToolExecute(ctx, payload, state)
      handleToolResult(ctx, payload, state)
      handleTuiToast(ctx, payload, state)
    } catch (err) {
      console.error(pc.red(`[event error] ${err}`))
    }
  }
}
