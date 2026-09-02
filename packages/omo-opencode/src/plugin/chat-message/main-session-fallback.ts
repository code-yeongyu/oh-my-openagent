import type { OhMyOpenCodeConfig } from "../../config"
import type { AgentOverrideConfig } from "../../config/schema/agent-overrides"
import { subagentSessions } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import {
  flattenToFallbackModelStrings,
  normalizeFallbackModels,
} from "../../shared/model-resolver"
import { log } from "../../shared/logger"
import { resolveModelForDelegateTask } from "../../tools/delegate-task/model-selection"

export type RequestedModel = { providerID: string; modelID: string }

export type PromotedFallbackModel = {
  providerID: string
  modelID: string
  variant?: string
}

type AgentConfigLookup = Record<string, AgentOverrideConfig | undefined>

function findAgentConfig(
  pluginConfig: OhMyOpenCodeConfig,
  agent: string,
): AgentOverrideConfig | undefined {
  const agents = pluginConfig.agents as AgentConfigLookup | undefined
  if (!agents) return undefined

  const agentConfigKey = getAgentConfigKey(agent)
  const direct = agents[agentConfigKey]
  if (direct) return direct

  const lowered = agentConfigKey.toLowerCase()
  return Object.entries(agents).find(([key]) => key.toLowerCase() === lowered)?.[1]
}

function resolveFallbackEntriesForAgent(
  pluginConfig: OhMyOpenCodeConfig,
  agentConfig: AgentOverrideConfig | undefined,
): (string | { model: string; variant?: string })[] | undefined {
  const ownFallbacks = normalizeFallbackModels(agentConfig?.fallback_models)
  if (ownFallbacks && ownFallbacks.length > 0) return ownFallbacks

  const category =
    typeof agentConfig?.category === "string" ? agentConfig.category : undefined
  const categoryFallbacks = category
    ? normalizeFallbackModels(pluginConfig.categories?.[category]?.fallback_models)
    : undefined
  if (categoryFallbacks && categoryFallbacks.length > 0) return categoryFallbacks

  return undefined
}

/**
 * Resolve a proactive fallback promotion for the main interactive session.
 *
 * Mirrors the delegated-task behavior of `resolveModelForDelegateTask`: when the
 * requested primary model is not reachable against warm availability data, the
 * first reachable entry of the agent's configured `fallback_models` (own or via
 * its category) is promoted. Cold availability data defers without guessing.
 * Delegated subagent sessions are skipped - the delegate path already owns them.
 */
export function resolveMainSessionFallbackModel(params: {
  sessionID: string
  agent?: string
  requestedModel?: RequestedModel
  pluginConfig: OhMyOpenCodeConfig
  availableModels: ReadonlySet<string>
}): PromotedFallbackModel | undefined {
  const { sessionID, agent, requestedModel, pluginConfig, availableModels } = params

  if (!requestedModel) return undefined
  if (!agent) return undefined
  if (subagentSessions.has(sessionID)) return undefined
  // Empty availability data means cold caches; promoting on it would be guessing.
  if (availableModels.size === 0) return undefined

  const agentConfig = findAgentConfig(pluginConfig, agent)
  if (!agentConfig) return undefined

  const fallbackEntries = resolveFallbackEntriesForAgent(pluginConfig, agentConfig)
  if (!fallbackEntries || fallbackEntries.length === 0) return undefined

  const resolution = resolveModelForDelegateTask({
    userModel: `${requestedModel.providerID}/${requestedModel.modelID}`,
    userFallbackModels: flattenToFallbackModelStrings(fallbackEntries),
    availableModels,
  })

  if (!resolution || "skipped" in resolution) return undefined
  if (!resolution.matchedFallback) return undefined

  const normalized = normalizeModelFormat(resolution.model)
  if (!normalized) return undefined

  return resolution.variant
    ? {
        providerID: normalized.providerID,
        modelID: normalized.modelID,
        variant: resolution.variant,
      }
    : { providerID: normalized.providerID, modelID: normalized.modelID }
}

const lastPromotedModelBySession = new Map<string, string>()

/**
 * @internal For testing only
 */
export function _resetMainSessionFallbackStateForTesting(): void {
  lastPromotedModelBySession.clear()
}

function extractMessageModel(value: unknown): RequestedModel | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  const providerID = record["providerID"]
  const modelID = record["modelID"]
  if (typeof providerID !== "string" || typeof modelID !== "string") return undefined
  return { providerID, modelID }
}

/**
 * Proactively promote a reachable `fallback_models` entry for the main session
 * when its requested primary model is unavailable. Mutates `output.message`
 * only when a promotion happens; `input` is never modified, so downstream
 * runtime-fallback state tracking keeps seeing the originally requested model.
 */
export async function applyMainSessionFallbackOverride(args: {
  input: { sessionID: string; agent?: string; model?: RequestedModel }
  output: { message: Record<string, unknown> }
  pluginConfig: OhMyOpenCodeConfig
  getAvailableModels: () => Promise<ReadonlySet<string>>
  notify?: (title: string, message: string) => void
}): Promise<void> {
  const { input, output, pluginConfig, getAvailableModels, notify } = args

  const requestedModel = input.model ?? extractMessageModel(output.message.model)
  if (!requestedModel) return

  let availableModels: ReadonlySet<string>
  try {
    availableModels = await getAvailableModels()
  } catch (error) {
    log("[main-session-fallback] availability lookup failed; skipping promotion", {
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  const promoted = resolveMainSessionFallbackModel({
    sessionID: input.sessionID,
    agent: input.agent,
    requestedModel,
    pluginConfig,
    availableModels,
  })
  if (!promoted) return

  output.message.model = { providerID: promoted.providerID, modelID: promoted.modelID }
  if (promoted.variant) {
    output.message.variant = promoted.variant
  } else {
    delete output.message.variant
  }

  const promotedKey = `${promoted.providerID}/${promoted.modelID}${promoted.variant ? `(${promoted.variant})` : ""}`
  if (lastPromotedModelBySession.get(input.sessionID) === promotedKey) return

  lastPromotedModelBySession.set(input.sessionID, promotedKey)
  log("[main-session-fallback] promoted fallback_models entry for main session", {
    sessionID: input.sessionID,
    agent: input.agent,
    requested: `${requestedModel.providerID}/${requestedModel.modelID}`,
    promoted: promotedKey,
  })
  notify?.(
    "Model Fallback",
    `Primary model unavailable - switched to ${promoted.modelID}`,
  )
}
