import type { AgentConfig, CategoryConfig, GeneratedOmoConfig, ProviderAvailability } from "./model-fallback-types"
import { transformModelForProvider } from "../shared/provider-model-id-transform"

type OpenAiOnlyProfile = "general" | "quick"

type OpenAiOnlyOverride = {
  profile: OpenAiOnlyProfile
  variant?: string
}

const OPENAI_ONLY_PROFILE_MODELS: Record<OpenAiOnlyProfile, string> = {
  general: "gpt-5",
  quick: "gpt-5-mini",
}

const OPENAI_ONLY_AGENT_OVERRIDES: Record<string, OpenAiOnlyOverride> = {
  explore: { profile: "general", variant: "medium" },
  librarian: { profile: "general", variant: "medium" },
}

const OPENAI_ONLY_CATEGORY_OVERRIDES: Record<string, OpenAiOnlyOverride> = {
  artistry: { profile: "general", variant: "xhigh" },
  quick: { profile: "quick" },
  "visual-engineering": { profile: "general", variant: "high" },
  writing: { profile: "general", variant: "medium" },
}

function resolveOpenAiOnlyOverrideModel(profile: OpenAiOnlyProfile): string {
  const model = transformModelForProvider("openai", OPENAI_ONLY_PROFILE_MODELS[profile])
  return `openai/${model}`
}

function materializeOpenAiOnlyOverrides<T extends AgentConfig | CategoryConfig>(
  overrides: Record<string, OpenAiOnlyOverride>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(overrides).map(([key, value]) => [
      key,
      {
        model: resolveOpenAiOnlyOverrideModel(value.profile),
        ...(value.variant ? { variant: value.variant } : {}),
      },
    ]),
  ) as Record<string, T>
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
      ...materializeOpenAiOnlyOverrides<AgentConfig>(OPENAI_ONLY_AGENT_OVERRIDES),
    },
    categories: {
      ...config.categories,
      ...materializeOpenAiOnlyOverrides<CategoryConfig>(OPENAI_ONLY_CATEGORY_OVERRIDES),
    },
  }
}
