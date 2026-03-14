import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message"
import { isProviderBlacklisted } from "../../shared/global-blacklist"
import { log } from "../../shared/logger"
import { subagentSessions, getMainSessionID } from "../../features/claude-code-session-state"
import { setSessionFallbackChain, setPendingModelFallback } from "../model-fallback/hook"
import type { OhMyOpenCodeConfig } from "../../config"
import type { FallbackEntry } from "../../shared/model-requirements"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { buildFallbackChainFromModels } from "../../shared/fallback-chain-from-models"
import { getFallbackModelsForSession } from "../runtime-fallback/fallback-models"
import {
  setSessionProviderOverride,
  getSessionProviderOverride,
  clearSessionProviderOverride,
} from "../../shared/session-provider-override"

/**
 * Track which sessions we've processed for initial setup.
 * This is still used to set up fallback chains on first message,
 * but we now check for blacklisted providers on EVERY message.
 */
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
 * Finds the first available fallback provider that is not blacklisted.
 * Iterates through the fallback chain and returns the first healthy provider.
 */
function findHealthyFallback(
  fallbackChain: FallbackEntry[],
): { providerID: string; modelID: string; variant?: string; index: number } | null {
  for (let i = 0; i < fallbackChain.length; i++) {
    const entry = fallbackChain[i]
    const firstProvider = entry.providers[0]

    // Skip blacklisted providers
    if (isProviderBlacklisted(firstProvider)) {
      log("[blacklist-guard] Skipping blacklisted fallback provider", {
        provider: firstProvider,
        index: i,
      })
      continue
    }

    // Found non-blacklisted provider
    return {
      providerID: firstProvider,
      modelID: entry.model,
      variant: entry.variant,
      index: i,
    }
  }

  return null
}

/**
 * Applies a provider override to the message output.
 * This forces the message to use the fallback provider instead of the blacklisted one.
 */
function applyProviderOverride(
  output: ChatMessageHandlerOutput,
  override: { providerID: string; modelID: string; variant?: string },
): void {
  output.message["providerID"] = override.providerID
  output.message["modelID"] = override.modelID
  if (override.variant) {
    output.message["variant"] = override.variant
  }

  // Also set the model object for compatibility
  output.message["model"] = {
    providerID: override.providerID,
    modelID: override.modelID,
  }
}

/**
 * Hook that guards ALL sessions (main and subagent) against blacklisted providers.
 *
 * KEY BEHAVIOR CHANGE:
 * Previously, this only checked the first message per session. Now it checks EVERY message
 * to ensure that if a provider becomes blacklisted mid-session, we continue using the fallback
 * for all subsequent messages until the provider recovers.
 *
 * This solves the problem where:
 * 1. User is on provider A
 * 2. Provider A gets blacklisted (rate limited)
 * 3. Subagent correctly falls back to provider B
 * 4. But main session UI still shows provider A
 * 5. User sends another message -> still tries to use blacklisted provider A
 *
 * Now, step 5 will detect that provider A is blacklisted and automatically use provider B.
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

      // Check if this session has an active provider override
      const existingOverride = getSessionProviderOverride(sessionID)

      // CASE 1: Session has an active override - check if original provider recovered
      if (existingOverride) {
        const originalProvider = existingOverride.originalProviderID

        // If original provider is still blacklisted, continue using override
        if (isProviderBlacklisted(originalProvider)) {
          log("[blacklist-guard] Provider still blacklisted, applying override", {
            sessionID,
            originalProvider,
            fallbackProvider: existingOverride.providerID,
          })

          applyProviderOverride(output, existingOverride)
          return
        }

        // Original provider has recovered - clear the override
        log("[blacklist-guard] Original provider recovered, clearing override", {
          sessionID,
          originalProvider,
        })
        clearSessionProviderOverride(sessionID)
        // Continue to normal processing below
      }

      // CASE 2: Check if current provider is blacklisted
      const blacklisted = isProviderBlacklisted(providerID)

      if (!blacklisted) {
        // Provider is healthy - normal first-time setup if needed
        if (!processedSessions.has(sessionID)) {
          processedSessions.add(sessionID)
          log("[blacklist-guard] First message, provider healthy", {
            sessionID,
            providerID,
            agentName,
            isSubagent,
            isMainSession,
          })
        }
        return
      }

      // Provider IS blacklisted - need to find fallback
      log("[blacklist-guard] Provider IS blacklisted, switching to fallback", {
        sessionID,
        providerID,
        agentName,
        isMainSession,
      })

      // Determine effective agent name
      const effectiveAgentName = agentName || (isSubagent ? "sisyphus-junior" : "sisyphus")

      // Set up fallback chain (only on first encounter)
      if (!processedSessions.has(sessionID)) {
        processedSessions.add(sessionID)

        const fallbackChain = applyUserConfiguredFallbackChain(
          sessionID,
          effectiveAgentName,
          providerID,
          args.pluginConfig
        )

        if (fallbackChain && fallbackChain.length > 0) {
          setSessionFallbackChain(sessionID, fallbackChain)
        }
      }

      // Get the fallback chain (either just set or from previous)
      const fallbackChain = applyUserConfiguredFallbackChain(
        sessionID,
        effectiveAgentName,
        providerID,
        args.pluginConfig
      )

      if (!fallbackChain || fallbackChain.length === 0) {
        log("[blacklist-guard] No fallback chain available", {
          sessionID,
          agentName: effectiveAgentName,
        })

        // No fallback available - arm for next message retry
        setPendingModelFallback(sessionID, effectiveAgentName, providerID, modelID)
        log("[blacklist-guard] No immediate fallback available, armed for next message", {
          sessionID,
          providerID,
        })
        return
      }

      // Find the first healthy fallback provider
      const selectedFallback = findHealthyFallback(fallbackChain)

      if (selectedFallback) {
        // Store the override for future messages
        setSessionProviderOverride(
          sessionID,
          providerID, // original blacklisted provider
          selectedFallback.providerID,
          selectedFallback.modelID,
          selectedFallback.variant
        )

        // Apply the override to this message
        applyProviderOverride(output, selectedFallback)

        log("[blacklist-guard] Switched to fallback provider", {
          sessionID,
          fromProvider: providerID,
          fromModel: modelID,
          toProvider: selectedFallback.providerID,
          toModel: selectedFallback.modelID,
          fallbackIndex: selectedFallback.index,
          isMainSession,
        })
      } else {
        // All fallbacks are also blacklisted - arm for retry
        setPendingModelFallback(sessionID, effectiveAgentName, providerID, modelID)
        log("[blacklist-guard] All fallbacks blacklisted, armed for retry", {
          sessionID,
          providerID,
        })
      }
    },
  }
}

/**
 * Cleanup when session is deleted.
 * Removes the session from processed set and clears any provider override.
 */
export function clearBlacklistGuard(sessionID: string): void {
  processedSessions.delete(sessionID)
  clearSessionProviderOverride(sessionID)
}
