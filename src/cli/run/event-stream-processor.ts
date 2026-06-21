import pc from "picocolors"
import { logEventVerbose } from "./event-formatting"
import {
  handleMessagePartUpdated,
  handleMessageUpdated,
  handleSessionError,
  handleSessionIdle,
  handleSessionStatus,
  handleToolExecute,
  handleToolResult,
  handleTuiToast,
} from "./event-handlers"
import type { EventState } from "./event-state"
import type { EventPayload, RunContext } from "./types"

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
        console.error(pc.dim(`[event] no type: ${JSON.stringify(event)}`))
        continue
      }

      logEventVerbose(ctx, payload)

      handleSessionError(ctx, payload, state)
      handleSessionIdle(ctx, payload, state)
      handleSessionStatus(ctx, payload, state)
      handleMessagePartUpdated(ctx, payload, state)
      handleMessageUpdated(ctx, payload, state)
      handleToolExecute(ctx, payload, state)
      handleToolResult(ctx, payload, state)
      handleTuiToast(ctx, payload, state)
    } catch (err) {
      console.error(pc.red(`[event error] ${err}`))
    }
  }
}
