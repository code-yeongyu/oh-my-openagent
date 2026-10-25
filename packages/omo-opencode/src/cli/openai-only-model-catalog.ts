import type { AgentConfig, CategoryConfig, GeneratedOmoConfig, ProviderAvailability } from "./model-fallback-types"
import { LATEST_MODEL_BY_FAMILY } from "@oh-my-opencode/model-core/latest-models"

const OPENAI_ONLY_AGENT_OVERRIDES: Record<string, AgentConfig> = {
  explore: { model: `openai/${LATEST_MODEL_BY_FAMILY.gptLunaFast}`, variant: "low" },
  librarian: { model: `openai/${LATEST_MODEL_BY_FAMILY.gptLunaFast}`, variant: "low" },
}

const OPENAI_ONLY_CATEGORY_OVERRIDES: Record<string, CategoryConfig> = {
  artistry: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  quick: { model: `openai/${LATEST_MODEL_BY_FAMILY.gptLunaFast}` },
  "visual-engineering": { model: "openai/gpt-5.6-sol", variant: "high" },
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
