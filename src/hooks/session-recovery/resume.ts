import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { MessageData, ResumeConfig } from "./types"

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
  }
}

export async function resumeSession(client: Client, config: ResumeConfig): Promise<boolean> {
  try {
    await client.session.promptAsync({
      path: { id: config.sessionID },
      body: {
        parts: [{ type: "text", text: RECOVERY_RESUME_TEXT }],
        agent: config.agent,
        model: config.model,
      },
    })
    return true
  } catch {
    return false
  }
}
