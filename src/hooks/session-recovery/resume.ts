import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { MessageData, ResumeConfig } from "./types"
import { createInternalAgentContinuationTextPart, resolveInheritedPromptTools } from "../../shared"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"

const RECOVERY_RESUME_TEXT = "[session recovered - continuing previous task]"

type Client = ReturnType<typeof createOpencodeClient>

export function findLastUserMessage(messages: MessageData[]): MessageData | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info?.role === "user") {
      return messages[i]
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

    const promptResult = await promptAsyncAfterSessionIdle({
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
