import type { OhMyOpenCodeConfig } from "../../config"
import type { FallbackModelObject } from "../../config/schema/fallback-models"
import { agentPattern } from "./agent-resolver"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { normalizeFallbackModels, flattenToFallbackModelStrings } from "../../shared/model-resolver"

/**
 * Per-message override scope. `"agent"` walks the standard
 * category → agent fallback chain. `"ultrawork"` and `"compaction"` first
 * consult the matching scoped `fallback_models` on the agent config, falling
 * back to the agent-level chain if absent. See #3779 for motivation.
 */
export type FallbackScope = "agent" | "ultrawork" | "compaction"

/**
 * Returns fallback model strings for the runtime-fallback system.
 * Object entries are flattened to "provider/model(variant)" strings so the
 * string-based fallback state machine can work with them unchanged.
 */
export function getFallbackModelsForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig | undefined
): string[] {
  if (!pluginConfig) return []

  const raw = getRawFallbackModelsForSession(sessionID, agent, pluginConfig, "agent")
  return flattenToFallbackModelStrings(raw) ?? []
}

/**
 * Returns the raw fallback model entries (strings and objects) for a session.
 * Use this when per-model settings (temperature, reasoningEffort, etc.) must be
 * preserved - e.g. before passing to buildFallbackChainFromModels.
 */
export function getRawFallbackModels(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig | undefined,
): (string | FallbackModelObject)[] | undefined {
  if (!pluginConfig) return undefined
  return getRawFallbackModelsForSession(sessionID, agent, pluginConfig, "agent")
}

/**
 * Returns raw fallback model entries respecting an override scope. When
 * `scope` is "ultrawork" or "compaction", the agent's matching nested
 * `fallback_models` array wins over the agent-level chain. When the scoped
 * field is unset, the result is identical to {@link getRawFallbackModels}.
 *
 * This is the entry point used by ultrawork and compaction so a config like:
 * ```jsonc
 * { agents: { sisyphus: {
 *   fallback_models: ["openai/gpt-5.5"],
 *   ultrawork: { model: "anthropic/claude-opus-4-7", variant: "max",
 *                fallback_models: ["openai/gpt-5.5", "google/gemini-3.1-flash-preview"] }
 * } } }
 * ```
 * produces a different recovery chain for ultrawork-triggered failures than
 * for ordinary messages — see #3538 (variant=max unsupported by Copilot
 * claude-opus-4.6) for the failure mode this addresses.
 */
export function getRawFallbackModelsForScope(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig | undefined,
  scope: FallbackScope,
): (string | FallbackModelObject)[] | undefined {
  if (!pluginConfig) return undefined
  return getRawFallbackModelsForSession(sessionID, agent, pluginConfig, scope)
}

function tryGetScopedFallback(
  agentConfig: Record<string, unknown> | undefined,
  scope: FallbackScope,
): (string | FallbackModelObject)[] | undefined {
  if (!agentConfig || scope === "agent") return undefined
  const scopedConfig = agentConfig[scope] as { fallback_models?: unknown } | undefined
  if (!scopedConfig?.fallback_models) return undefined
  return normalizeFallbackModels(
    scopedConfig.fallback_models as Parameters<typeof normalizeFallbackModels>[0],
  )
}

function getRawFallbackModelsForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig,
  scope: FallbackScope,
): (string | FallbackModelObject)[] | undefined {
  const sessionCategory = SessionCategoryRegistry.get(sessionID)
  if (sessionCategory && pluginConfig.categories?.[sessionCategory]) {
    const categoryConfig = pluginConfig.categories[sessionCategory]
    if (categoryConfig?.fallback_models) {
      return normalizeFallbackModels(categoryConfig.fallback_models)
    }
  }

  const tryGetFallbackFromAgent = (agentName: string): (string | FallbackModelObject)[] | undefined => {
    const agentConfig = pluginConfig.agents?.[agentName as keyof typeof pluginConfig.agents]
    if (!agentConfig) return undefined

    const scoped = tryGetScopedFallback(agentConfig as Record<string, unknown>, scope)
    if (scoped) return scoped

    if (agentConfig?.fallback_models) {
      return normalizeFallbackModels(agentConfig.fallback_models)
    }

    const agentCategory = agentConfig?.category
    if (agentCategory && pluginConfig.categories?.[agentCategory]) {
      const categoryConfig = pluginConfig.categories[agentCategory]
      if (categoryConfig?.fallback_models) {
        return normalizeFallbackModels(categoryConfig.fallback_models)
      }
    }

    return undefined
  }

  if (agent) {
    const result = tryGetFallbackFromAgent(agent)
    if (result) return result
  }

  const sessionAgentMatch = sessionID.match(agentPattern)
  if (sessionAgentMatch) {
    const detectedAgent = sessionAgentMatch[1].toLowerCase()
    const result = tryGetFallbackFromAgent(detectedAgent)
    if (result) return result
  }

  log(`[${HOOK_NAME}] No category/agent fallback models resolved for session`, { sessionID, agent, scope })

  return undefined
}
