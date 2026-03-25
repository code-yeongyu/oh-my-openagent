import type { AgentConfig, CategoryConfig, GeneratedOmoConfig, ProviderAvailability } from "./model-fallback-types"

const OPENAI_ONLY_AGENT_OVERRIDES: Record<string, AgentConfig> = {
  explore: { model: "openai/gpt-5.4", variant: "medium" },
  librarian: { model: "openai/gpt-5.4", variant: "medium" },
}

const OPENAI_ONLY_CATEGORY_OVERRIDES: Record<string, CategoryConfig> = {
  artistry: { model: "openai/gpt-5.4", variant: "xhigh" },
  quick: { model: "openai/gpt-5.4-mini" },
  "visual-engineering": { model: "openai/gpt-5.4", variant: "high" },
  writing: { model: "openai/gpt-5.4", variant: "medium" },
}

export function isOpenAiOnlyAvailability(availability: ProviderAvailability): boolean {
  return (
    availability.native.openai &&
    !availability.native.claude &&
    !availability.native.gemini &&
    !availability.opencodeGo &&
    !availability.opencodeZen &&
    !availability.copilot &&
    !availability.zai &&
    !availability.kimiForCoding
  )
}

export function applyOpenAiOnlyModelCatalog(config: GeneratedOmoConfig): GeneratedOmoConfig {
  return {
    ...config,
    agents: {
      ...config.agents,
      ...OPENAI_ONLY_AGENT_OVERRIDES,
    },
    categories: {
      ...config.categories,
      ...OPENAI_ONLY_CATEGORY_OVERRIDES,
    },
  }
}
