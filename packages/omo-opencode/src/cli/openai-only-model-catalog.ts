import {
  OPENAI_ONLY_AGENT_RECOMMENDATIONS,
  OPENAI_ONLY_CATEGORY_RECOMMENDATIONS,
  type OpenAiOnlyRecommendation,
} from "@oh-my-opencode/delegate-core"

import type { AgentConfig, CategoryConfig, GeneratedOmoConfig, ProviderAvailability } from "./model-fallback-types"

// Derived, never hand-mirrored: delegate-core owns the maintained catalog and OMO Native compiles
// the same record at runtime. Duplicating the literals here would let a catalog update silently
// leave one edition stale, which no test on a self-consistent copy can detect.
function toOverride(recommendation: OpenAiOnlyRecommendation): AgentConfig & CategoryConfig {
  return {
    model: `openai/${recommendation.modelId}`,
    ...(recommendation.variant === undefined ? {} : { variant: recommendation.variant }),
  }
}

function toOverrides(
  recommendations: Readonly<Record<string, OpenAiOnlyRecommendation>>,
): Record<string, AgentConfig & CategoryConfig> {
  return Object.fromEntries(Object.entries(recommendations).map(([name, rec]) => [name, toOverride(rec)]))
}

const OPENAI_ONLY_AGENT_OVERRIDES: Record<string, AgentConfig> = toOverrides(OPENAI_ONLY_AGENT_RECOMMENDATIONS)

const OPENAI_ONLY_CATEGORY_OVERRIDES: Record<string, CategoryConfig> = toOverrides(
  OPENAI_ONLY_CATEGORY_RECOMMENDATIONS,
)

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
