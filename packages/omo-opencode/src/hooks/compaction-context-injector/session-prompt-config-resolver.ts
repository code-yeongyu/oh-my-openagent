import { getSessionAgent } from "../../features/claude-code-session-state"
import type { CompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { normalizePromptTools } from "../../shared/prompt-tools"
import { getSessionModel } from "../../shared/session-model-state"
import { getSessionTools } from "../../shared/session-tools-store"
import { isCompactionAgent } from "./session-id"
import { resolveValidatedModel } from "./validated-model"

type SessionMessage = {
  info?: {
    agent?: string
    model?: {
      providerID?: string
      modelID?: string
    }
    providerID?: string
    modelID?: string
    tools?: Record<string, boolean | "allow" | "deny" | "ask">
  }
}

type ResolverContext = {
  client: {
    session: {
      messages: (input: { path: { id: string } }) => Promise<unknown>
    }
  }
  directory: string
}

export async function resolveSessionPromptConfig(
  ctx: ResolverContext,
  sessionID: string,
): Promise<CompactionAgentConfigCheckpoint> {
  const storedModel = getSessionModel(sessionID)
  const promptConfig: CompactionAgentConfigCheckpoint = {
    agent: getSessionAgent(sessionID),
    tools: getSessionTools(sessionID),
  }

  try {
    const response = await ctx.client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SessionMessage[], {
      preferResponseOnMissingData: true,
    })

    for (let index = messages.length - 1; index >= 0; index--) {
      const info = messages[index].info

      if (!promptConfig.agent && info?.agent && !isCompactionAgent(info.agent)) {
        promptConfig.agent = info.agent
      }

      if (!promptConfig.model) {
        const model = resolveValidatedModel(info)
        if (model) {
          promptConfig.model = model
        }
      }

      if (!promptConfig.tools) {
        const tools = normalizePromptTools(info?.tools)
        if (tools) {
          promptConfig.tools = tools
        }
      }

      if (promptConfig.agent && promptConfig.model && promptConfig.tools) {
        break
      }
    }
  } catch (error) {
    log("[compaction-context-injector] Failed to resolve prompt config from messages", {
      sessionID,
      directory: ctx.directory,
      error: String(error),
    })
  }

  if (!promptConfig.model && storedModel) {
    promptConfig.model = storedModel
  }

  return promptConfig
}

export async function resolveLatestSessionPromptConfig(
  ctx: ResolverContext,
  sessionID: string,
): Promise<CompactionAgentConfigCheckpoint> {
  try {
    const response = await ctx.client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SessionMessage[], {
      preferResponseOnMissingData: true,
    })
    const latestInfo = messages.at(-1)?.info

    if (!latestInfo) {
      return {}
    }

    const model = resolveValidatedModel(latestInfo)
    const tools = normalizePromptTools(latestInfo.tools)

    return {
      ...(latestInfo.agent ? { agent: latestInfo.agent } : {}),
      ...(model ? { model } : {}),
      ...(tools ? { tools } : {}),
    }
  } catch (error) {
    log("[compaction-context-injector] Failed to resolve latest prompt config", {
      sessionID,
      directory: ctx.directory,
      error: String(error),
    })
    return {}
  }
}
