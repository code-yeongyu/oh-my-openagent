import { log } from "../../shared/logger"
import { resolveToolCallID, type ToolCallIDCarrier } from "./resolve-tool-call-id"
import { storeToolMetadata, type PendingToolMetadata } from "./store"

export interface ToolMetadataPublisherContext extends ToolCallIDCarrier {
  sessionID: string
  metadata?: (input: PendingToolMetadata) => void | Promise<void>
}

export async function publishToolMetadata(
  ctx: ToolMetadataPublisherContext,
  payload: PendingToolMetadata
): Promise<{ stored: boolean }> {
  await ctx.metadata?.(payload)

  const callID = resolveToolCallID(ctx)
  if (!callID) {
    log("[tool-metadata-store] Skipping metadata store publish because tool call ID is unavailable", {
      sessionID: ctx.sessionID,
      hasTitle: typeof payload.title === "string",
      hasMetadata: payload.metadata !== undefined,
    })
    return { stored: false }
  }

  storeToolMetadata(ctx.sessionID, callID, payload)
  return { stored: true }
}
