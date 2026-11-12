import { log, normalizePromptTools, normalizeSDKResponse, resolveInheritedPromptTools } from "../../shared"
import { resolvePromptContextFromSessionMessages } from "../background-agent/compaction-aware-message-resolver"
import type { MonitorPromptClient } from "./manager-internals"

type PromptContextMessage = Parameters<typeof resolvePromptContextFromSessionMessages>[0][number]

export type MonitorParentPromptContext = {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  tools?: Record<string, boolean>
}

/**
 * The agent, model and tools the parent's last turn ran with. A notice prompt must carry them: opencode takes the
 * turn's agent and model from the newest user message, so a notice without them switches the parent to its agent's
 * default model.
 */
export async function resolveMonitorParentPromptContext(
  client: MonitorPromptClient,
  directory: string,
  sessionID: string,
): Promise<MonitorParentPromptContext> {
  let messages: PromptContextMessage[] = []
  try {
    const response = await client.session?.messages?.({ path: { id: sessionID }, query: { directory } })
    messages = normalizeSDKResponse(response, [] as PromptContextMessage[])
  } catch (error) {
    log("[monitor] Could not read the parent's agent and model for a notice:", { sessionID, error: String(error) })
  }
  const context = resolvePromptContextFromSessionMessages(Array.isArray(messages) ? messages : [], sessionID)
  const tools = resolveInheritedPromptTools(sessionID, normalizePromptTools(context?.tools))
  return {
    ...(context?.agent ? { agent: context.agent } : {}),
    ...(context?.model?.providerID && context.model.modelID
      ? { model: { providerID: context.model.providerID, modelID: context.model.modelID } }
      : {}),
    ...(context?.model?.variant ? { variant: context.model.variant } : {}),
    ...(tools ? { tools } : {}),
  }
}
