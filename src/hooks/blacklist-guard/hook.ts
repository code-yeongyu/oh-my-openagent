import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message"
import { isProviderBlacklisted } from "../../shared/global-blacklist"
import { log } from "../../shared/logger"
import { subagentSessions, getMainSessionID } from "../../features/claude-code-session-state"
import { setSessionFallbackChain, setPendingModelFallback, getNextFallback } from "../model-fallback/hook"
import type { OhMyOpenCodeConfig } from "../../config"
import type { FallbackEntry } from "../../shared/model-requirements"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { buildFallbackChainFromModels } from "../../shared/fallback-chain-from-models"
import { getFallbackModelsForSession } from "../runtime-fallback/fallback-models"

// Track which sessions we've already processed
const processedSessions = new Set<string>()

function applyUserConfiguredFallbackChain(
  sessionID: string,
  agentName: string,
  currentProviderID: string,
  pluginConfig: OhMyOpenCodeConfig,
): FallbackEntry[] | undefined {
  const agentKey = getAgentConfigKey(agentName)
  const configuredFallbackModels = getFallbackModelsForSession(sessionID, agentKey, pluginConfig)
  
  if (configuredFallbackModels.length === 0) {
    const requirements = AGENT_MODEL_REQUIREMENTS[agentKey]
    return requirements?.fallbackChain
  }

  const fallbackChain = buildFallbackChainFromModels(configuredFallbackModels, currentProviderID)
  return fallbackChain
}

/**
 * Hook that guards ALL sessions (main and subagent) against blacklisted providers.
 * Immediately switches to fallback provider if current provider is blacklisted.
 */
export function createBlacklistGuard(args: {
  pluginConfig: OhMyOpenCodeConfig
}) {
  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageHandlerOutput,
    ): Promise<void> => {
      const { sessionID } = input
      if (!sessionID) return

      // Only process first message per session
      if (processedSessions.has(sessionID)) return
      processedSessions.add(sessionID)

      // Get model info from input.model (where OpenCode puts it)
      const providerID = input.model?.providerID
      const modelID = input.model?.modelID
      const agentName = input.agent || (output.message as { agent?: string }).agent

      if (!providerID || !modelID) {
        log("[blacklist-guard] Missing providerID or modelID in input.model", { sessionID, inputModel: input.model })
        return
      }

      const isSubagent = subagentSessions.has(sessionID)
      const isMainSession = sessionID === getMainSessionID()
      
      log("[blacklist-guard] Checking first message", {
        sessionID,
        providerID,
        modelID,
        agentName,
        isSubagent,
        isMainSession,
      })

      // Check if provider is blacklisted
      const blacklisted = isProviderBlacklisted(providerID)
      
      if (!blacklisted) {
        log("[blacklist-guard] Provider not blacklisted", { sessionID, providerID })
        return
      }

      log("[blacklist-guard] Provider IS blacklisted, switching immediately", {
        sessionID,
        providerID,
        agentName,
      })

      // Determine effective agent name
      const effectiveAgentName = agentName || (isSubagent ? "sisyphus-junior" : "sisyphus")
      
      // Set up fallback chain
      const fallbackChain = applyUserConfiguredFallbackChain(
        sessionID, 
        effectiveAgentName, 
        providerID, 
        args.pluginConfig
      )

      if (fallbackChain && fallbackChain.length > 0) {
        setSessionFallbackChain(sessionID, fallbackChain)
        
        // Find first available fallback (skip blacklisted)
        let fallbackIndex = 0
        let selectedFallback = null
        
        for (let i = 0; i < fallbackChain.length; i++) {
          const entry = fallbackChain[i]
          const firstProvider = entry.providers[0]
          
          // Skip blacklisted providers
          if (isProviderBlacklisted(firstProvider)) {
            log("[blacklist-guard] Skipping blacklisted fallback provider", {
              sessionID,
              provider: firstProvider,
              index: i,
            })
            continue
          }
          
          // Found non-blacklisted provider
          selectedFallback = {
            providerID: firstProvider,
            modelID: entry.model,
            variant: entry.variant,
          }
          fallbackIndex = i
          break
        }
        
        if (selectedFallback) {
          // IMMEDIATELY switch the model in the output
          output.message["providerID"] = selectedFallback.providerID
          output.message["modelID"] = selectedFallback.modelID
          if (selectedFallback.variant) {
            output.message["variant"] = selectedFallback.variant
          }
          
          // Also set the model object for compatibility
          output.message["model"] = {
            providerID: selectedFallback.providerID,
            modelID: selectedFallback.modelID,
          }
          
          log("[blacklist-guard] Switched to fallback immediately", {
            sessionID,
            fromProvider: providerID,
            fromModel: modelID,
            toProvider: selectedFallback.providerID,
            toModel: selectedFallback.modelID,
            fallbackIndex,
          })
        } else {
          // No immediate fallback available, arm for next message
          setPendingModelFallback(sessionID, effectiveAgentName, providerID, modelID)
          log("[blacklist-guard] No immediate fallback available, armed for next message", {
            sessionID,
            providerID,
          })
        }
      } else {
        log("[blacklist-guard] No fallback chain available", { 
          sessionID, 
          agentName: effectiveAgentName,
        })
      }
    },
  }
}

// Cleanup when session is deleted
export function clearBlacklistGuard(sessionID: string): void {
  processedSessions.delete(sessionID)
}
