import type { OpencodeClient } from "./types"
import type { DelegatedModelConfig } from "../../shared/model-resolution-types"
import type { FallbackEntry } from "../../shared/model-requirements"
import { QUESTION_DENIED_SESSION_PERMISSION } from "../../shared/question-denied-session-permission"
import { log } from "../../shared/logger"

/**
 * Detect whether an error is a ProviderModelNotFoundError from the provider layer.
 * The error may arrive as a structured Error with name "ProviderModelNotFoundError",
 * as a nested error/cause, or as a message string containing "model not found".
 */
function isProviderModelNotFoundError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>
    if (record.name === "ProviderModelNotFoundError") return true
    // Check nested error objects (data, error, cause)
    for (const key of ["data", "error", "cause"] as const) {
      const nested = record[key]
      if (nested && typeof nested === "object") {
        const nestedRecord = nested as Record<string, unknown>
        if (nestedRecord.name === "ProviderModelNotFoundError") return true
      }
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  const lowered = message.toLowerCase()
  return lowered.includes("providermodelnotfounderror") || lowered.includes("model not found")
}

function toDelegatedModelConfig(
  entry: FallbackEntry,
  defaultProviderID: string,
): DelegatedModelConfig {
  // FallbackEntry.model can be "provider/model" or bare "model"
  const slash = entry.model.indexOf("/")
  if (slash > 0) {
    const providerID = entry.model.slice(0, slash).trim()
    const modelID = entry.model.slice(slash + 1).trim()
    return {
      providerID,
      modelID,
      ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
      ...(entry.reasoningEffort !== undefined ? { reasoningEffort: entry.reasoningEffort } : {}),
    }
  }
  return {
    providerID: defaultProviderID,
    modelID: entry.model,
    ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
    ...(entry.reasoningEffort !== undefined ? { reasoningEffort: entry.reasoningEffort } : {}),
  }
}

async function tryCreateSession(
  client: OpencodeClient,
  input: {
    parentSessionID: string
    agentToUse: string
    description: string
    defaultDirectory: string
    categoryModel?: DelegatedModelConfig
  },
): Promise<{ ok: true; sessionID: string; parentDirectory: string } | { ok: false; error: string }> {
  const parentSession = await client.session.get({ path: { id: input.parentSessionID } }).catch(() => null)
  const parentDirectory = parentSession?.data?.directory ?? input.defaultDirectory

  let createResult
  try {
    createResult = await client.session.create({
      body: {
        parentID: input.parentSessionID,
        title: `${input.description} (@${input.agentToUse} subagent)`,
        permission: QUESTION_DENIED_SESSION_PERMISSION,
        ...(input.categoryModel
          ? {
              model: {
                id: input.categoryModel.modelID,
                providerID: input.categoryModel.providerID,
                ...(input.categoryModel.variant ? { variant: input.categoryModel.variant } : {}),
              },
            }
          : {}),
      } as Record<string, unknown>,
      query: {
        directory: parentDirectory,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Failed to create session: ${message}` }
  }

  if (createResult.error !== undefined) {
    return { ok: false, error: `Failed to create session: ${createResult.error}` }
  }
  if (createResult.data === undefined) {
    return { ok: false, error: "Failed to create session: missing session data" }
  }

  return { ok: true, sessionID: createResult.data.id, parentDirectory }
}

type CreateSyncSessionResult = { ok: true; sessionID: string; parentDirectory: string; effectiveCategoryModel?: DelegatedModelConfig } | { ok: false; error: string }

/**
 * Create a sync session for a delegated task.
 *
 * When the primary model throws ProviderModelNotFoundError (e.g. the model does not exist
 * in the provider), the function advances through the fallback chain, trying each model
 * in order until one succeeds or all are exhausted.  This prevents the session from dying
 * immediately when the first model in a category's `models` array is unavailable.
 *
 * Returns `effectiveCategoryModel` when a fallback model was used, so the caller can
 * update its own state (prompt sending, metadata, toast) to match the working model.
 */
export async function createSyncSession(
  client: OpencodeClient,
  input: {
    parentSessionID: string
    agentToUse: string
    description: string
    defaultDirectory: string
    categoryModel?: DelegatedModelConfig
    fallbackChain?: FallbackEntry[]
  },
): Promise<CreateSyncSessionResult> {
  // Try the primary model first
  const primaryResult = await tryCreateSession(client, input)
  if (primaryResult.ok) {
    return primaryResult
  }

  // Only retry with fallback models for model-not-found errors
  if (!isProviderModelNotFoundError(primaryResult.error)) {
    return primaryResult
  }

  // No fallback chain available
  if (!input.fallbackChain || input.fallbackChain.length === 0) {
    return primaryResult
  }

  const defaultProviderID = input.categoryModel?.providerID ?? "opencode"

  for (const fallbackEntry of input.fallbackChain) {
    const fallbackModel = toDelegatedModelConfig(fallbackEntry, defaultProviderID)

    // Skip if fallback is the same model as the primary (no-op retry)
    if (
      fallbackModel.providerID === input.categoryModel?.providerID &&
      fallbackModel.modelID === input.categoryModel?.modelID
    ) {
      continue
    }

    log("[createSyncSession] Retrying with fallback model after ProviderModelNotFoundError", {
      failed: `${input.categoryModel?.providerID}/${input.categoryModel?.modelID}`,
      trying: `${fallbackModel.providerID}/${fallbackModel.modelID}`,
    })

    const result = await tryCreateSession(client, {
      ...input,
      categoryModel: fallbackModel,
    })

    if (result.ok) {
      return { ...result, effectiveCategoryModel: fallbackModel }
    }

    // If this is also a model-not-found error, continue to next fallback
    if (!isProviderModelNotFoundError(result.error)) {
      return result
    }
  }

  // All fallbacks exhausted — return the primary error for a clear message
  return primaryResult
}
