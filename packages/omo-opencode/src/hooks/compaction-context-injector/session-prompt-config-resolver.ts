import { getSessionAgent } from "../../features/claude-code-session-state"
import type { CompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint"
import { isActiveCompactionPin } from "../../shared/compaction-pin-state"
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
      variant?: string
    }
    providerID?: string
    modelID?: string
    variant?: string
    tools?: Record<string, boolean | "allow" | "deny" | "ask">
  }
  // fix: compaction-part-marker — marker rows carry a compaction part
  parts?: Array<{ type?: string }>
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
      // fix: compaction-part-marker — a row carrying a compaction part is a
      // marker (bookkeeping), never working-model evidence, even when tagged
      // with the working agent (observed 2026-09-27T23:37Z).
      const rowParts = messages[index]?.parts
      const markerRow =
        Array.isArray(rowParts) &&
        rowParts.some((part) => part?.type === "compaction")

      if (!promptConfig.agent && info?.agent && !isCompactionAgent(info.agent)) {
        promptConfig.agent = info.agent
      }

      if (!promptConfig.model && markerRow) {
        log("[compaction-context-injector] skipped compaction-part marker row in working-model scan (compaction-part-marker)", {
          sessionID,
          skippedAgent: info?.agent,
        })
      }
      if (!promptConfig.model && !markerRow) {
        const model = resolveValidatedModel(info)
        // fix: compaction-pin-checkpoint — a marker/summary row carrying the
        // active compaction pin (often tagged with the working agent, not
        // "compaction") is the summarizer's model, never the working model.
        if (model && isActiveCompactionPin(sessionID, model)) {
          log("[compaction-context-injector] skipped compaction pin model in checkpoint capture (compaction-pin-checkpoint)", {
            sessionID,
            skipped: `${model.providerID}/${model.modelID}`,
          })
        } else if (model) {
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

  if (!promptConfig.model && storedModel && !isActiveCompactionPin(sessionID, storedModel)) {
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
    const latestMessage = messages.at(-1)
    const latestInfo = latestMessage?.info
    // fix: compaction-part-marker
    const latestMarkerRow =
      Array.isArray(latestMessage?.parts) &&
      latestMessage.parts.some((part) => part?.type === "compaction")

    if (!latestInfo) {
      return {}
    }

    const model = latestMarkerRow ? undefined : resolveValidatedModel(latestInfo)
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
