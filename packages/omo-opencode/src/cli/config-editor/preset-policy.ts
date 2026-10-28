import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  LATEST_MODEL_BY_FAMILY,
  type FallbackEntry,
} from "@oh-my-opencode/model-core"

export const EDITOR_PRESET_IDS = ["performance", "balanced", "budget"] as const
export type EditorPresetId = typeof EDITOR_PRESET_IDS[number]
export type EditorPresetRolePolicy = {
  readonly section: "agents" | "categories"
  readonly name: string
  readonly candidates: readonly string[]
}

// Routed ids are intentional exact aliases. The cache must list the entire routed id;
// neither display names, substrings nor an arbitrary provider's copy qualify.
function routedId(model: string): string | undefined {
  if (model.startsWith("claude-")) return `anthropic/${model}`
  if (model.startsWith("gpt-")) return `openai/${model}`
  if (model === LATEST_MODEL_BY_FAMILY.kimi) return `moonshotai/${model}`
  if (model === "deepseek-flash") return `deepseek/${model}`
  return undefined
}

function candidates(chain: readonly FallbackEntry[]): string[] {
  return [...new Set(chain.flatMap((entry) => {
    const direct = entry.providers.map((provider) => `${provider}/${entry.model}`)
    const routed = routedId(entry.model)
    return routed === undefined ? direct : [...direct, `openrouter/${routed}`]
  }))]
}

const agent = (name: string): readonly FallbackEntry[] => AGENT_MODEL_REQUIREMENTS[name]?.fallbackChain ?? []
const category = (name: string): readonly FallbackEntry[] => CATEGORY_MODEL_REQUIREMENTS[name]?.fallbackChain ?? []
const select = (chain: readonly FallbackEntry[], models: readonly string[]): FallbackEntry[] => chain.filter((rung) => models.includes(rung.model))

/** Curated declarations, not a price table or an automatic runtime policy. */
export function getEditorPresetPolicy(id: string): readonly EditorPresetRolePolicy[] {
  if (!EDITOR_PRESET_IDS.some((known) => known === id)) throw new Error(`Unknown built-in preset: ${id}`)
  const kimi = select(agent("sisyphus"), [LATEST_MODEL_BY_FAMILY.kimi])
  const glm = select(category("unspecified-high"), [LATEST_MODEL_BY_FAMILY.glm])
  const sonnet = select(category("unspecified-low"), [LATEST_MODEL_BY_FAMILY.claudeSonnet, "claude-sonnet-5"])
  const reasoning = [...kimi, ...glm]
  const balanced = [...reasoning, ...sonnet]
  const gpt = select(agent("hephaestus"), ["gpt-5.6-sol"])
  const cheap = [
    ...select(category("quick"), [LATEST_MODEL_BY_FAMILY.claudeHaiku]),
    ...select(category("quick"), ["deepseek-flash"]),
    ...select(category("quick"), [LATEST_MODEL_BY_FAMILY.gptLunaFast]),
  ]
  const balancedAgents: Record<string, readonly FallbackEntry[]> = {
    sisyphus: balanced, hephaestus: gpt, oracle: balanced,
    librarian: balanced, explore: balanced,
    "multimodal-looker": agent("multimodal-looker").filter((rung) => rung.model !== "gpt-5-nano"),
    prometheus: balanced, metis: balanced, momus: balanced, atlas: balanced,
    "sisyphus-junior": balanced,
  }
  const budgetAgents: Record<string, readonly FallbackEntry[]> = {
    sisyphus: reasoning, hephaestus: gpt, oracle: reasoning,
    librarian: cheap, explore: cheap,
    // All candidates come from the existing vision requirement. Budget tries nano first.
    "multimodal-looker": [...select(agent("multimodal-looker"), ["gpt-5-nano"]), ...agent("multimodal-looker").filter((rung) => rung.model !== "gpt-5-nano")],
    prometheus: reasoning, metis: reasoning, momus: reasoning, atlas: reasoning,
    "sisyphus-junior": cheap,
  }
  const balancedCategories: Record<string, readonly FallbackEntry[]> = {
    "visual-engineering": balanced, ultrabrain: gpt, "deep-low": gpt, "deep-high": gpt,
    artistry: balanced, quick: balanced, "unspecified-low": balanced,
    "unspecified-high": balanced, writing: balanced,
  }
  const budgetCategories: Record<string, readonly FallbackEntry[]> = {
    "visual-engineering": reasoning, ultrabrain: gpt, "deep-low": gpt, "deep-high": gpt,
    artistry: reasoning, quick: cheap, "unspecified-low": cheap,
    "unspecified-high": reasoning, writing: cheap,
  }
  return ([
    ["agents", AGENT_MODEL_REQUIREMENTS],
    ["categories", CATEGORY_MODEL_REQUIREMENTS],
  ] as const).flatMap(([section, requirements]) => Object.entries(requirements).map(([name, requirement]) => {
    let chain: readonly FallbackEntry[] = requirement.fallbackChain
    if (id !== "performance") {
      const policies = section === "agents"
        ? id === "budget" ? budgetAgents : balancedAgents
        : id === "budget" ? budgetCategories : balancedCategories
      // A newly introduced role needs an intentional policy before cost tiers can import.
      chain = Object.hasOwn(policies, name) ? policies[name] ?? [] : []
    }
    return { section, name, candidates: candidates(chain) }
  }))
}
