import type { ToolContextWithMetadata } from "./types"

export function resolveToolCallID(ctx: ToolContextWithMetadata): string | undefined {
  if (typeof ctx.callID === "string" && ctx.callID.trim() !== "") return ctx.callID
  if (typeof ctx.callId === "string" && ctx.callId.trim() !== "") return ctx.callId
  if (typeof ctx.call_id === "string" && ctx.call_id.trim() !== "") return ctx.call_id
  return undefined
}
