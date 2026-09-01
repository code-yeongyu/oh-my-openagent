import { isRecord } from "@oh-my-opencode/utils"
import type { TransformPart, UnpairedToolPart } from "./types"

export { isRecord }

const TERMINAL_TOOL_STATUSES = new Set(["completed", "error"])

export const UNKNOWN_TOOL_STATUS = "unknown"

export function toRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

export function getToolCallID(part: TransformPart): string | null {
  const record = toRecord(part)
  if (!record || record["type"] !== "tool") {
    return null
  }

  const callID = record["callID"]
  return typeof callID === "string" && callID.length > 0 ? callID : null
}

export function getToolStatus(part: TransformPart): string {
  const state = toRecord(toRecord(part)?.["state"])
  if (!state) {
    return UNKNOWN_TOOL_STATUS
  }

  const status = state["status"]
  return typeof status === "string" && status.length > 0 ? status : UNKNOWN_TOOL_STATUS
}

export function isTerminalToolStatus(status: string): boolean {
  return TERMINAL_TOOL_STATUSES.has(status)
}

/**
 * OpenCode has no standalone `tool_use` or `tool_result` part. A single assistant
 * `tool` part is converted into BOTH the `tool_use` block and its `tool_result`
 * block, but only once the part carries a terminal (`completed` / `error`) state.
 * A part still in `pending` / `running` is therefore the only shape that can reach
 * the provider as a `tool_use` without a paired `tool_result`.
 */
export function findUnpairedToolParts(parts: TransformPart[]): UnpairedToolPart[] {
  const seen = new Set<string>()
  const unpaired: UnpairedToolPart[] = []

  for (const part of parts) {
    const callID = getToolCallID(part)
    if (!callID || seen.has(callID)) {
      continue
    }

    const status = getToolStatus(part)
    if (isTerminalToolStatus(status)) {
      continue
    }

    seen.add(callID)
    unpaired.push({ callID, status })
  }

  return unpaired
}
