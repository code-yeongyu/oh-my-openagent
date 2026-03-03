import pc from "picocolors"
import { safeCompress } from "../../shared/toon-compression"
import type { RunContext, EventPayload } from "./types"
import type { EventState } from "./event-state"
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

function compressPayloadData(
   data: unknown,
   isErrorResponse: boolean
 ): string {
   if (isErrorResponse) {
     return JSON.stringify(data)
   }
   return safeCompress(data, "cli-event-stream")
 }

export function compressEventData(
  data: unknown
): string {
  const isErrorResponse =
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    (data as EventPayload).type === "session.error"

   if (isErrorResponse) {
     return JSON.stringify(data)
   }
   return safeCompress(data, "cli-event-stream")
 }

export function compressEventPayload(
  payload: EventPayload
): string {
  return compressEventData(payload)
}

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
          const eventStr = compressPayloadData(event, false)
          console.error(pc.dim(`[event] no type: ${eventStr}`))
        }
        continue
      }

      if (ctx.verbose) {
        const compressedStr = compressEventPayload(payload)
        console.error(pc.dim(`[event] ${compressedStr}`))
      }

      // Update last event timestamp for watchdog detection
      state.lastEventTimestamp = Date.now()

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
