import { subagentSessions, getMainSessionID } from "../../features/claude-code-session-state"
import { getSessionModel, setSessionModel } from "../../shared/session-model-state"
import type { ChatMessageHandlerOutput, ChatMessageInput, SessionModelOverride } from "./types"

export function getStoredMainSessionModel(
  input: ChatMessageInput,
  isFirstMessage: boolean,
): SessionModelOverride | undefined {
  if (isFirstMessage) {
    return undefined
  }

  if (subagentSessions.has(input.sessionID)) {
    return undefined
  }

  if (getMainSessionID() !== input.sessionID) {
    return undefined
  }

  if (input.model) {
    return undefined
  }

  return getSessionModel(input.sessionID)
}

export function recordSessionModel(input: ChatMessageInput, output: ChatMessageHandlerOutput): void {
  const modelOverride = output.message.model
  if (
    modelOverride &&
    typeof modelOverride === "object" &&
    "providerID" in modelOverride &&
    "modelID" in modelOverride
  ) {
    const providerID = (modelOverride as { readonly providerID?: string }).providerID
    const modelID = (modelOverride as { readonly modelID?: string }).modelID
    if (typeof providerID === "string" && typeof modelID === "string") {
      setSessionModel(input.sessionID, { providerID, modelID })
    }
  } else if (input.model) {
    setSessionModel(input.sessionID, input.model)
  }
}
