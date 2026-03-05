import * as p from "@clack/prompts"
import color from "picocolors"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { loadProviderModelsFromCache, flattenProviderModels } from "./cache"
import { resolveModel } from "./resolve"

export type PreflightChange = {
  path: string
  from?: string
  to?: string
  reason: string
}

export type PreflightResult = {
  config: OhMyOpenCodeConfig
  changes: PreflightChange[]
  warnings: string[]
}

type ExtendedAgentConfig = {
  model?: string
  fallback_model?: string
  [key: string]: unknown
}

type ExtendedCategoryConfig = {
  model?: string
  [key: string]: unknown
}

type ExtendedConfig = OhMyOpenCodeConfig & {
  model?: string
  agents?: Record<string, ExtendedAgentConfig>
  categories?: Record<string, ExtendedCategoryConfig>
}

export function preflightConfig(config: OhMyOpenCodeConfig): PreflightResult {
  const providerModels = loadProviderModelsFromCache()
  const available = flattenProviderModels(providerModels)
  
  const changes: PreflightChange[] = []
  const warnings: string[] = []
  
  const nextConfig = JSON.parse(JSON.stringify(config)) as ExtendedConfig
  
  if (available.size === 0) {
    warnings.push("No models found in cache. Run 'opencode models --refresh' to update.")
  }
  
  if (nextConfig.agents) {
    for (const [agentName, agent] of Object.entries(nextConfig.agents)) {
      if (!agent) continue
      
      const extAgent = agent as ExtendedAgentConfig
      const preferred = extAgent.model
      const fallback = extAgent.fallback_model
      
      const { model, result } = resolveModel({
        preferred,
        fallbacks: [fallback],
        available
      })
      
      if (result.changed && model) {
        extAgent.model = model
        changes.push({
          path: `agents.${agentName}.model`,
          from: result.from,
          to: result.to,
          reason: result.reason ?? "missing"
        })
      }
      
      if (fallback && !available.has(fallback)) {
        warnings.push(`Agent "${agentName}" fallback_model "${fallback}" not available`)
      }
    }
  }
  
  if (nextConfig.categories) {
    for (const [categoryName, category] of Object.entries(nextConfig.categories)) {
      if (!category) continue
      
      const preferred = category.model
      
      const { model, result } = resolveModel({
        preferred,
        fallbacks: [],
        available
      })
      
      if (result.changed && model) {
        category.model = model
        changes.push({
          path: `categories.${categoryName}.model`,
          from: result.from,
          to: result.to,
          reason: result.reason ?? "missing"
        })
      }
    }
  }
  
  if (nextConfig.model && !available.has(nextConfig.model)) {
    warnings.push(`Default model "${nextConfig.model}" not available`)
  }
  
  return { config: nextConfig as OhMyOpenCodeConfig, changes, warnings }
}

/**
 * Display preflight results to user
 */
export function displayPreflightResults(result: PreflightResult): void {
  if (result.changes.length === 0 && result.warnings.length === 0) {
    p.log.success(color.green("✓ Preflight check passed - all models available"))
    return
  }
  
  console.log()
  console.log(color.bgCyan(color.black(" Preflight Check ")))
  console.log()
  
  // Show changes
  if (result.changes.length > 0) {
    console.log(color.yellow("Auto-switched unavailable models:"))
    for (const change of result.changes) {
      const icon = color.yellow("→")
      console.log(`  ${icon} ${change.path}`)
      console.log(`     ${color.dim(change.from ?? "none")} → ${color.cyan(change.to ?? "none")}`)
      console.log(`     ${color.dim(`(${change.reason})`)}`)
    }
    console.log()
  }
  
  // Show warnings
  if (result.warnings.length > 0) {
    console.log(color.yellow("Warnings:"))
    for (const warning of result.warnings) {
      console.log(`  ${color.yellow("!")} ${warning}`)
    }
    console.log()
  }
}
