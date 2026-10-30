import { extractAssistantText } from "../rpc/turn-outcome"
import type { RpcTerminalAssistantMessage } from "../types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function extractTerminalAssistantMessage(message: unknown): RpcTerminalAssistantMessage | undefined {
  if (!isRecord(message)) return undefined
  const record = message
  if (record.role !== "assistant") return undefined
  const text = extractAssistantText(record)
  const stopReason = typeof record.stopReason === "string" ? record.stopReason : undefined
  const errorMessage = typeof record.errorMessage === "string" ? record.errorMessage : undefined
  return {
    ...(text === undefined ? {} : { text }),
    ...(stopReason === undefined ? {} : { stopReason }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
  }
}
