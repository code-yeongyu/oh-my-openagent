import type { createOpencodeClient } from "@opencode-ai/sdk"
import {
  createInternalAgentContinuationTextPart,
  isRealUserMessage,
} from "../../shared/internal-initiator-marker"
import { resolveInheritedPromptTools } from "../../shared/prompt-tools"
import { dispatchInternalPrompt } from "../shared/prompt-async-gate"
import type { MessageData, ResumeConfig } from "./types"

const RECOVERY_RESUME_TEXT = "[session recovered - continuing previous task]"

type Client = ReturnType<typeof createOpencodeClient>

export function findLastUserMessage(messages: MessageData[]): MessageData | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message !== undefined && isRealUserMessage(message)) {
      return message
    }
  }
  return undefined
}

export function extractResumeConfig(userMessage: MessageData | undefined, sessionID: string): ResumeConfig {
  return {
    sessionID,
    agent: userMessage?.info?.agent,
    model: userMessage?.info?.model,
    tools: userMessage?.info?.tools,
  }
}

export async function resumeSession(client: Client, config: ResumeConfig): Promise<boolean> {
  try {
    const inheritedTools = resolveInheritedPromptTools(config.sessionID, config.tools)
    const launchModel = config.model
      ? { providerID: config.model.providerID, modelID: config.model.modelID }
      : undefined
    const launchVariant = config.model?.variant

    const promptResult = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: config.sessionID,
      source: "session-recovery",
      input: {
        path: { id: config.sessionID },
        body: {
          parts: [createInternalAgentContinuationTextPart(RECOVERY_RESUME_TEXT)],
          agent: config.agent,
          ...(launchModel ? { model: launchModel } : {}),
          ...(launchVariant ? { variant: launchVariant } : {}),
          ...(inheritedTools ? { tools: inheritedTools } : {}),
        },
      },
    })
    return promptResult.status === "dispatched"
  } catch {
    return false
  }
}
