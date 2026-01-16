import type { OhMyOpenCodeConfig } from "../config"
import { getRuntimePluginConfig } from "./runtime-plugin-config"

export interface SubagentSettingsContext {
  directory?: string
  config?: OhMyOpenCodeConfig
}

function formatRecord(record: Record<string, number> | undefined): string {
  if (!record || Object.keys(record).length === 0) return "(none)"
  return JSON.stringify(record)
}

export function buildSubagentSettingsBlock(ctx?: SubagentSettingsContext): string {
  const config = ctx?.config ?? getRuntimePluginConfig()
  const bg = config?.background_task

  const defaultConcurrencyFallback = 5

  const defaultConcurrency = bg?.defaultConcurrency ?? defaultConcurrencyFallback
  const providerConcurrency = bg?.providerConcurrency
  const modelConcurrency = bg?.modelConcurrency

  const disabledAgents = config?.disabled_agents ?? []
  const disabledSkills = config?.disabled_skills ?? []
  const disabledMcps = config?.disabled_mcps ?? []
  const disabledHooks = config?.disabled_hooks ?? []

  const agentOverrides = config?.agents
  const agentOverrideSummary = agentOverrides
    ? {
        Sisyphus: agentOverrides.Sisyphus
          ? {
              model: agentOverrides.Sisyphus.model,
              category: agentOverrides.Sisyphus.category,
              skills: agentOverrides.Sisyphus.skills,
            }
          : undefined,
        explore: agentOverrides.explore
          ? {
              model: agentOverrides.explore.model,
              category: agentOverrides.explore.category,
              skills: agentOverrides.explore.skills,
            }
          : undefined,
        librarian: agentOverrides.librarian
          ? {
              model: agentOverrides.librarian.model,
              category: agentOverrides.librarian.category,
              skills: agentOverrides.librarian.skills,
            }
          : undefined,
        oracle: agentOverrides.oracle
          ? {
              model: agentOverrides.oracle.model,
              category: agentOverrides.oracle.category,
              skills: agentOverrides.oracle.skills,
            }
          : undefined,
      }
    : undefined

  const hasAgentOverrideSummary =
    agentOverrideSummary && Object.values(agentOverrideSummary).some(Boolean)

  const directoryLine = ctx?.directory ? `- directory: ${ctx.directory}` : undefined

  const lines = [
    "<SUBAGENT_SETTINGS>",
    ...(directoryLine ? [directoryLine] : []),
    "- background_task.defaultConcurrency: " +
      (bg?.defaultConcurrency !== undefined
        ? String(bg.defaultConcurrency)
        : `(unset; runtime fallback ${defaultConcurrencyFallback})`),
    "- background_task.providerConcurrency: " + formatRecord(providerConcurrency),
    "- background_task.modelConcurrency: " + formatRecord(modelConcurrency),
    "- effective default per-model limit: " + String(defaultConcurrency),
    "- concurrency enforcement: per model string (not global)",
    "- note: providerConcurrency is a per-model fallback; it does NOT cap total concurrency across multiple models",
    "- note: runtime treats limit=0 as unlimited, but config schema may reject 0 (min 1)",
    "- background tasks TTL: 30 minutes (stale tasks pruned)",
    "- subagent recursion prevention: explore/librarian deny tool calls like task/sisyphus_task/call_omo_agent",
    ...(hasAgentOverrideSummary
      ? ["- agent_overrides: " + JSON.stringify(agentOverrideSummary)]
      : []),
    "- disabled_agents: " + (disabledAgents.length ? JSON.stringify(disabledAgents) : "(none)"),
    "- disabled_skills: " + (disabledSkills.length ? JSON.stringify(disabledSkills) : "(none)"),
    "- disabled_mcps: " + (disabledMcps.length ? JSON.stringify(disabledMcps) : "(none)"),
    "- disabled_hooks: " + (disabledHooks.length ? JSON.stringify(disabledHooks) : "(none)"),
    "</SUBAGENT_SETTINGS>",
  ]

  return lines.join("\n")
}

export function appendSubagentSettingsToPrompt(
  prompt: string,
  ctx?: SubagentSettingsContext
): string {
  const block = buildSubagentSettingsBlock(ctx)
  return `${prompt}\n\n${block}`
}
