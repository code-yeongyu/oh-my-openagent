import type { AgentConfig, CategoryConfig, GeneratedOmoConfig, ProviderAvailability } from "./model-fallback-types"
import type { OpenAIPlan } from "./types"

// ChatGPT Plus/Pro subscriptions exclude these API-tier models (#5187)
export const API_ONLY_OPENAI_MODELS: ReadonlySet<string> = new Set(["gpt-5.6-terra"])

export function isApiOnlyOpenAiModel(model: string): boolean {
  return API_ONLY_OPENAI_MODELS.has(model)
}

export function isChatGptSubscriptionPlan(plan: OpenAIPlan | undefined): boolean {
  return plan === "plus" || plan === "pro"
}

const OPENAI_ONLY_AGENT_OVERRIDES: Record<string, AgentConfig> = {
  explore: { model: "openai/gpt-5.6-luna-fast", variant: "low" },
  librarian: { model: "openai/gpt-5.6-luna-fast", variant: "low" },
}

const OPENAI_ONLY_CATEGORY_OVERRIDES: Record<string, CategoryConfig> = {
  artistry: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  quick: { model: "openai/gpt-5.6-luna-fast" },
  "visual-engineering": { model: "openai/gpt-5.6-sol", variant: "high" },
  writing: { model: "openai/gpt-5.6-sol", variant: "medium" },
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
    !availability.kimiForCoding &&
    !availability.bailianCodingPlan &&
    !availability.minimaxCnCodingPlan &&
    !availability.minimaxCodingPlan &&
    !availability.vercelAiGateway
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
