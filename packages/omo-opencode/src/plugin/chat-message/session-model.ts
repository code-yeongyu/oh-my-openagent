import { getSessionAgent, subagentSessions, getMainSessionID } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { getStoredSessionModel, setSessionModel } from "../../shared/session-model-state"
import type { ChatMessageHandlerOutput, ChatMessageInput, SessionModelOverride } from "./types"

function resolveCurrentAgent(input: ChatMessageInput): string | undefined {
  return input.agent ?? getSessionAgent(input.sessionID)
}

function hasMatchingAgentOwner(input: ChatMessageInput, storedAgent: string | undefined): boolean {
  if (!storedAgent) {
    return true
  }

  const currentAgent = resolveCurrentAgent(input)
  if (!currentAgent) {
    return false
  }

  return getAgentConfigKey(storedAgent) === getAgentConfigKey(currentAgent)
}

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

  const storedModel = getStoredSessionModel(input.sessionID)
  if (!storedModel || !hasMatchingAgentOwner(input, storedModel.agent)) {
    return undefined
  }

  return { providerID: storedModel.providerID, modelID: storedModel.modelID }
}

export function recordSessionModel(input: ChatMessageInput, output: ChatMessageHandlerOutput): void {
  const modelOverride = output.message.model
  const agent = resolveCurrentAgent(input)
  if (
    modelOverride &&
    typeof modelOverride === "object" &&
    "providerID" in modelOverride &&
    "modelID" in modelOverride
  ) {
    const providerID = (modelOverride as { readonly providerID?: string }).providerID
    const modelID = (modelOverride as { readonly modelID?: string }).modelID
    if (typeof providerID === "string" && typeof modelID === "string") {
      setSessionModel(input.sessionID, { providerID, modelID }, agent)
    }
  } else if (input.model) {
    setSessionModel(input.sessionID, input.model, agent)
  }
}
