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

      // Check fallback_model
      if ((agent as { fallback_model?: string }).fallback_model) {
        const fallback = (agent as { fallback_model?: string }).fallback_model!.trim()
        if (fallback) {
          checkedModels.push({
            path: `agents.${agentName}.fallback_model`,
            model: fallback,
            type: "fallback",
          })

          if (!isValidModelFormat(fallback)) {
            issues.push({
              path: `agents.${agentName}.fallback_model`,
              level: "warn",
              message: `"${fallback}" has invalid format (expected: provider/model)`,
            })
          } else if (!cache.models.has(fallback)) {
            issues.push({
              path: `agents.${agentName}.fallback_model`,
              level: "warn",
              message: `"${fallback}" not found in model cache`,
            })
          }
        }
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
