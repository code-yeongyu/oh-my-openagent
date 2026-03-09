import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { SanityCheckResult, SanityIssue, ConfiguredModelRef } from "./types"
import { loadModelCache } from "./cache"

function isValidModelFormat(model: string): boolean {
  const parts = model.split("/")
  return parts.length >= 2 && parts[0].length > 0 && parts.slice(1).join("/").length > 0
}

function getProviderFromModel(model: string): string | null {
  const parts = model.split("/")
  return parts.length >= 2 ? parts[0] : null
}

export function runAgentSanityCheck(config: OhMyOpenCodeConfig): SanityCheckResult {
  const issues: SanityIssue[] = []
  const checkedModels: ConfiguredModelRef[] = []
  const cache = loadModelCache()

  const knownCategories = new Set(Object.keys(config.categories ?? {}))

  // Check agents
  if (config.agents) {
    for (const [agentName, agent] of Object.entries(config.agents)) {
      if (!agent) continue

      // Check agent model
      if (agent.model && typeof agent.model === "string") {
        const trimmedModel = agent.model.trim()
        if (trimmedModel) {
          checkedModels.push({
            path: `agents.${agentName}.model`,
            model: trimmedModel,
            type: "agent",
          })

          if (!isValidModelFormat(trimmedModel)) {
            issues.push({
              path: `agents.${agentName}.model`,
              level: "warn",
              message: `"${trimmedModel}" has invalid format (expected: provider/model)`,
            })
          } else if (!cache.models.has(trimmedModel)) {
            issues.push({
              path: `agents.${agentName}.model`,
              level: "warn",
              message: `"${trimmedModel}" not found in model cache`,
            })
          }
        }
      }

      // Check fallback_models (array)
      const fallbackModels = Array.isArray((agent as { fallback_models?: unknown }).fallback_models)
        ? ((agent as { fallback_models?: unknown }).fallback_models as unknown[])
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.trim())
            .filter(Boolean)
        : []

      for (const fallback of fallbackModels) {
        checkedModels.push({
          path: `agents.${agentName}.fallback_models`,
          model: fallback,
          type: "fallback",
        })

        if (!isValidModelFormat(fallback)) {
          issues.push({
            path: `agents.${agentName}.fallback_models`,
            level: "warn",
            message: `"${fallback}" has invalid format (expected: provider/model)`,
          })
        } else if (!cache.models.has(fallback)) {
          issues.push({
            path: `agents.${agentName}.fallback_models`,
            level: "warn",
            message: `"${fallback}" not found in model cache`,
          })
        }
      }

      // Check for missing fallback_models when model/category is set
      const hasModel = agent.model && typeof agent.model === "string" && agent.model.trim().length > 0
      const hasCategory = agent.category && typeof agent.category === "string" && agent.category.trim().length > 0
      const hasFallback = fallbackModels.length > 0

      if ((hasModel || hasCategory) && !hasFallback) {
        issues.push({
          path: `agents.${agentName}.fallback_models`,
          level: "warn",
          message: `agent "${agentName}" has model/category configured but no fallback_models`,
        })
      }

      // Check category reference
      if (agent.category && typeof agent.category === "string") {
        const trimmedCategory = agent.category.trim()
        if (trimmedCategory && !knownCategories.has(trimmedCategory)) {
          issues.push({
            path: `agents.${agentName}.category`,
            level: "warn",
            message: `references unknown category "${trimmedCategory}"`,
          })
        }
      }
    }
  }

  // Check categories
  if (config.categories) {
    for (const [categoryName, category] of Object.entries(config.categories)) {
      if (!category) continue

      if (category.model && typeof category.model === "string") {
        const trimmedModel = category.model.trim()
        if (trimmedModel) {
          checkedModels.push({
            path: `categories.${categoryName}.model`,
            model: trimmedModel,
            type: "category",
          })

          if (!isValidModelFormat(trimmedModel)) {
            issues.push({
              path: `categories.${categoryName}.model`,
              level: "warn",
              message: `"${trimmedModel}" has invalid format (expected: provider/model)`,
            })
          } else if (!cache.models.has(trimmedModel)) {
            issues.push({
              path: `categories.${categoryName}.model`,
              level: "warn",
              message: `"${trimmedModel}" not found in model cache`,
            })
          }
        }
      }
    }
  }

  return {
    issues,
    checkedModels,
    hasErrors: issues.some((i) => i.level === "error"),
    hasWarnings: issues.some((i) => i.level === "warn"),
  }
}
