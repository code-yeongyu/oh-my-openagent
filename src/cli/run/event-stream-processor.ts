import pc from "picocolors"
import { safeCompress } from "../../shared/toon-compression"
import type { RunContext, EventPayload, CompressionConfig } from "./types"
import { DEFAULT_COMPRESSION_CONFIG } from "./types"
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

function getCompressionConfig(ctx: RunContext): CompressionConfig {
  if (ctx.compression) {
    return {
      enabled: ctx.compression.enabled,
      threshold: ctx.compression.threshold,
    }
  }
  return DEFAULT_COMPRESSION_CONFIG
}

function compressPayloadData(
  data: unknown,
  config: CompressionConfig,
  isErrorResponse: boolean
): string {
  if (isErrorResponse) {
    return JSON.stringify(data)
  }
  return safeCompress(data, config)
}

export function compressEventData(
  data: unknown,
  config: CompressionConfig
): string {
  const isErrorResponse =
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    (data as EventPayload).type === "session.error"

  if (isErrorResponse) {
    return JSON.stringify(data)
  }
  return safeCompress(data, config)
}

export function compressEventPayload(
  payload: EventPayload,
  config: CompressionConfig
): string {
  return compressEventData(payload, config)
}

export async function processEvents(
  ctx: RunContext,
  stream: AsyncIterable<unknown>,
  state: EventState
): Promise<void> {
  for await (const event of stream) {
    if (ctx.abortController.signal.aborted) break

    try {
      const rawPayload = event as EventPayload
      if (!rawPayload?.type) {
        if (ctx.verbose) {
          const config = getCompressionConfig(ctx)
          const eventStr = compressPayloadData(event, config, false)
          console.error(pc.dim(`[event] no type: ${eventStr}`))
        }
        continue
      }

      const config = getCompressionConfig(ctx)

      if (ctx.verbose) {
        const compressedStr = compressEventPayload(rawPayload, config)
        console.error(pc.dim(`[event] ${compressedStr}`))
      }

      handleSessionError(ctx, rawPayload, state)
      handleSessionIdle(ctx, rawPayload, state)
      handleSessionStatus(ctx, rawPayload, state)
      handleMessagePartUpdated(ctx, rawPayload, state)
      handleMessagePartDelta(ctx, rawPayload, state)
      handleMessageUpdated(ctx, rawPayload, state)
      handleToolExecute(ctx, rawPayload, state)
      handleToolResult(ctx, rawPayload, state)
      handleTuiToast(ctx, rawPayload, state)
    } catch (err) {
      console.error(pc.red(`[event error] ${err}`))
    }
  }
}
