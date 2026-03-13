import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message"
import { isProviderBlacklisted } from "../../shared/global-blacklist"
import { log } from "../../shared/logger"
import { subagentSessions } from "../../features/claude-code-session-state"
import { setSessionFallbackChain, setPendingModelFallback } from "../model-fallback/hook"
import type { OhMyOpenCodeConfig } from "../../config"
import type { FallbackEntry } from "../../shared/model-requirements"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { buildFallbackChainFromModels } from "../../shared/fallback-chain-from-models"
import { getFallbackModelsForSession } from "../runtime-fallback/fallback-models"

// Track which subagent sessions we've already set up fallback for
const subagentFallbackSetup = new Set<string>()

function normalizeModelID(modelID: string): string {
  return modelID.toLowerCase().replace(/\./g, "-")
}

function applyUserConfiguredFallbackChain(
  sessionID: string,
  agentName: string,
  currentProviderID: string,
  pluginConfig: OhMyOpenCodeConfig,
): FallbackEntry[] | undefined {
  const agentKey = getAgentConfigKey(agentName)
  const configuredFallbackModels = getFallbackModelsForSession(sessionID, agentKey, pluginConfig)
  
  if (configuredFallbackModels.length === 0) {
    // Use default agent requirements
    const requirements = AGENT_MODEL_REQUIREMENTS[agentKey]
    return requirements?.fallbackChain
  }

  const fallbackChain = buildFallbackChainFromModels(configuredFallbackModels, currentProviderID)
  return fallbackChain
}

/**
 * Hook that guards subagent creation against blacklisted providers.
 * When a subagent's first message is sent, this hook checks if the provider
 * is blacklisted and sets up a fallback chain if needed.
 */
export function createSubagentBlacklistGuard(args: {
  pluginConfig: OhMyOpenCodeConfig
}) {
  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageHandlerOutput,
    ): Promise<void> => {
      const { sessionID } = input
      if (!sessionID) return

      // Only process subagent sessions
      if (!subagentSessions.has(sessionID)) return

      // Only process once per session (first message)
      if (subagentFallbackSetup.has(sessionID)) return
      subagentFallbackSetup.add(sessionID)

      const message = output.message as { providerID?: string; modelID?: string; agent?: string }
      const providerID = message.providerID
      const modelID = message.modelID
      const agentName = message.agent

      if (!providerID || !modelID) {
        log("[subagent-blacklist-guard] Missing providerID or modelID", { sessionID })
        return
      }

      log("[subagent-blacklist-guard] Checking subagent first message", {
        sessionID,
        providerID,
        modelID,
        agentName,
      })

      // Check if provider is blacklisted
      const blacklisted = await isProviderBlacklisted(providerID)
      
      if (!blacklisted) {
        log("[subagent-blacklist-guard] Provider not blacklisted", { sessionID, providerID })
        return
      }

      log("[subagent-blacklist-guard] Provider is blacklisted, setting up fallback", {
        sessionID,
        providerID,
        agentName,
      })

      // Set up fallback chain for this subagent
      const fallbackChain = agentName 
        ? applyUserConfiguredFallbackChain(sessionID, agentName, providerID, args.pluginConfig)
        : undefined

      if (fallbackChain && fallbackChain.length > 0) {
        setSessionFallbackChain(sessionID, fallbackChain)
        
        // Immediately set pending fallback to trigger on this message
        if (agentName && providerID && modelID) {
          const setResult = setPendingModelFallback(sessionID, agentName, providerID, modelID)
          log("[subagent-blacklist-guard] Fallback armed", { 
            sessionID, 
            agentName, 
            setResult,
            fallbackChainLength: fallbackChain.length 
          })
        }
      } else {
        log("[subagent-blacklist-guard] No fallback chain available", { 
          sessionID, 
          agentName,
          hasAgentName: !!agentName 
        })
      }
    },
  }
}

// Cleanup when session is deleted
export function clearSubagentBlacklistGuard(sessionID: string): void {
  subagentFallbackSetup.delete(sessionID)
}
