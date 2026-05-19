import type { ToolContextWithMetadata } from "./types"

export function resolveCallID(ctx: ToolContextWithMetadata): string | undefined {
  return ctx.callID ?? ctx.callId ?? ctx.call_id
}
