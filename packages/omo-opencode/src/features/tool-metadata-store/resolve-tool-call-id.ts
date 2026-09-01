import { log } from "../../shared/logger"

export interface ToolCallIDCarrier {
  callID?: string
  callId?: string
  call_id?: string
}

function normalizeCallID(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

export function resolveToolCallID(ctx: ToolCallIDCarrier): string | undefined {
  const resolved = normalizeCallID(ctx.callID) ?? normalizeCallID(ctx.callId) ?? normalizeCallID(ctx.call_id)

  if (!resolved) {
    log("[tool-metadata-store] Missing tool call ID for metadata correlation")
  }

  return resolved
}
