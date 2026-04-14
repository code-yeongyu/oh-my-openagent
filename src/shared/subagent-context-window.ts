import type { DelegatedModelConfig } from "./model-resolution-types"
import { findProviderModelMetadata, readProviderModelsCache } from "./connected-providers-cache"

const SMALL_SUBAGENT_CONTEXT_WINDOW_TOKENS = 32_768
const SUBAGENT_PROMPT_CONTEXT_RATIO = 0.5
const MIN_SUBAGENT_PROMPT_BUDGET_TOKENS = 2_048

function normalizeContextLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

export function resolveModelContextWindowTokens(
  model: DelegatedModelConfig | undefined,
): number | undefined {
  if (!model) {
    return undefined
  }

  const metadata = findProviderModelMetadata(
    model.providerID,
    model.modelID,
    readProviderModelsCache(),
  )

  return normalizeContextLimit(metadata?.limit?.context)
    ?? normalizeContextLimit(metadata?.limit?.input)
    ?? normalizeContextLimit(metadata?.context)
}

export function shouldDetachSubagentSession(
  model: DelegatedModelConfig | undefined,
): boolean {
  const contextWindow = resolveModelContextWindowTokens(model)
  return contextWindow !== undefined && contextWindow <= SMALL_SUBAGENT_CONTEXT_WINDOW_TOKENS
}

export function resolveSubagentPromptTokenBudget(
  model: DelegatedModelConfig | undefined,
): number | undefined {
  const contextWindow = resolveModelContextWindowTokens(model)
  if (contextWindow === undefined || contextWindow > SMALL_SUBAGENT_CONTEXT_WINDOW_TOKENS) {
    return undefined
  }

  return Math.max(
    MIN_SUBAGENT_PROMPT_BUDGET_TOKENS,
    Math.floor(contextWindow * SUBAGENT_PROMPT_CONTEXT_RATIO),
  )
}

export function buildSubagentSessionCreateBody(input: {
  parentSessionID: string
  title: string
  permission?: unknown
  model?: DelegatedModelConfig
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: input.title,
  }

  if (input.permission !== undefined) {
    body.permission = input.permission
  }

  if (!shouldDetachSubagentSession(input.model)) {
    body.parentID = input.parentSessionID
  }

  return body
}
