import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { getFallbackModelsForSession } from "./fallback-models"
import { normalizeModelToCanonicalString } from "./normalize-model"
import type { HookDeps } from "./types"

function isRuntimeFallbackRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function resolveEventModel(props: Record<string, unknown> | undefined): string | undefined {
  const normalizedModel = normalizeModelToCanonicalString(props?.model)
  if (normalizedModel) return normalizedModel

  const providerID = props?.providerID
  const modelID = props?.modelID
  return typeof providerID === "string" && typeof modelID === "string"
    ? `${providerID}/${modelID}`
    : undefined
}

export function resolveCreatedSessionModel(
  sessionID: string,
  props: Record<string, unknown> | undefined,
  pluginConfig: HookDeps["pluginConfig"],
) {
  const sessionInfo = props ? props.info : undefined
  const sessionRecord = isRuntimeFallbackRecord(sessionInfo) ? sessionInfo : undefined
  const model = normalizeModelToCanonicalString(sessionRecord?.model)
  const sessionAgent = sessionRecord?.agent
  const agent = typeof sessionAgent === "string"
    ? sessionAgent
    : props && typeof props.agent === "string"
      ? props.agent
      : undefined

  if (!model) return undefined

  const agentConfig = agent && pluginConfig?.agents ? pluginConfig.agents[agent] : undefined
  const category = typeof agentConfig?.category === "string"
    ? agentConfig.category
    : SessionCategoryRegistry.get(sessionID)
  const categoryModel = category ? pluginConfig?.categories?.[category]?.model : undefined
  const preferredModel = typeof agentConfig?.model === "string"
    ? agentConfig.model
    : typeof categoryModel === "string"
      ? categoryModel
      : undefined
  const fallbackIndex = preferredModel && preferredModel !== model
    ? getFallbackModelsForSession(sessionID, agent, pluginConfig).indexOf(model)
    : -1

  return { model, preferredModel, fallbackIndex }
}
