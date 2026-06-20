import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { getAvailableModelsForDelegateTask } from "../delegate-task/available-models"

// The reasoning/variant vocabulary accepted by `reasoning_effort` (and embedded
// `model "<variant>"`). Values are normalized per-model at resolution time —
// unsupported ones are downgraded or dropped, never hard-failed.
export const REASONING_VALUES = ["minimal", "low", "medium", "high", "xhigh", "max"] as const

export function formatModelList(models: ReadonlySet<string>, providerFilter?: string): string {
  if (models.size === 0) {
    return "(no connected models detected yet — cold cache. You may still pass a \"provider/model\" you know is connected; it is accepted on a cold cache and validated once the model list warms up.)"
  }
  const byProvider = new Map<string, string[]>()
  const filter = providerFilter?.trim().toLowerCase()
  for (const full of models) {
    const idx = full.indexOf("/")
    const provider = idx === -1 ? full : full.slice(0, idx)
    const modelId = idx === -1 ? full : full.slice(idx + 1)
    if (filter && provider.toLowerCase() !== filter) continue
    const arr = byProvider.get(provider) ?? []
    arr.push(modelId)
    byProvider.set(provider, arr)
  }
  if (byProvider.size === 0) {
    return `(no connected models for provider "${providerFilter}". Omit the provider filter to see all.)`
  }
  const lines: string[] = []
  for (const provider of [...byProvider.keys()].sort()) {
    lines.push(`${provider}:`)
    for (const modelId of byProvider.get(provider)!.sort()) {
      lines.push(`  - ${provider}/${modelId}`)
    }
  }
  return lines.join("\n")
}

export function buildListModelsOutput(models: ReadonlySet<string>, providerFilter?: string): string {
  return [
    "# Available models — pass any of these verbatim as `model`",
    formatModelList(models, providerFilter),
    "",
    "# Reasoning / variant values for `reasoning_effort`",
    `${REASONING_VALUES.join(", ")} (auto-normalized per model; unsupported values are downgraded or dropped).`,
    "",
    "# How to use",
    'task(subagent_type="librarian", model="<provider/model>", reasoning_effort="<value>", run_in_background=true, description="...", prompt="...")',
    'call_omo_agent(subagent_type="explore", model="<provider/model>", reasoning_effort="<value>", run_in_background=true, description="...", prompt="...")',
    "Omit `model` to use the configured default for that agent/category. Unknown models are rejected.",
  ].join("\n")
}

export function createListModelsTools(ctx: PluginInput): Record<string, ToolDefinition> {
  const list_models: ToolDefinition = tool({
    description:
      "List the models currently connected/available to this OpenCode session (grouped by provider), plus the valid " +
      "reasoning/variant values. Call this BEFORE passing a per-call `model` (and `reasoning_effort`) to `task`, " +
      "`call_omo_agent`, or a team member, so you choose a model that actually exists — unknown models are rejected. " +
      "Returns provider/model ids you can pass verbatim.",
    args: {
      provider: tool.schema
        .string()
        .optional()
        .describe('Optional provider id to filter by (e.g. "openai", "anthropic", "google"). Omit to list every connected provider.'),
    },
    execute: async (args) => {
      try {
        const models = await getAvailableModelsForDelegateTask(ctx.client)
        return buildListModelsOutput(models, args.provider)
      } catch (e) {
        return `Error listing models: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  return { list_models }
}
