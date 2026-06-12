import { isEmptyNoProgressAssistantTurnInfo } from "./empty-assistant-turn"

export function messageUpdatedInfoHasParentWakeOutput(info: Record<string, unknown>, role: unknown): boolean {
  if (role === "tool") {
    return true
  }
  if (role !== "assistant") {
    return false
  }
  if (info.error) {
    return false
  }
  return !isEmptyNoProgressAssistantTurnInfo(info)
}
