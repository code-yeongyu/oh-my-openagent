import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  ATLAS_CLOUD_PROVIDER_ID,
  type ModelRequirement,
} from "../shared/model-requirements"

const ATLAS_CLOUD_SUPPORTED_MODELS = new Set([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "glm-5.2",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "kimi-k3",
  "minimax-m2.7",
  "minimax-m3",
  "MiniMax-M3",
  "mimo-v2.5-pro",
  "qwen3.7-plus",
])

function withAtlasCloudProvider(requirements: Record<string, ModelRequirement>): Record<string, ModelRequirement> {
  return Object.fromEntries(
    Object.entries(requirements).map(([name, requirement]) => [
      name,
      {
        ...requirement,
        fallbackChain: requirement.fallbackChain.map((entry) => {
          if (!ATLAS_CLOUD_SUPPORTED_MODELS.has(entry.model)) return entry
          const vercelIndex = entry.providers.indexOf("vercel")
          const providers = entry.providers.includes(ATLAS_CLOUD_PROVIDER_ID)
            ? entry.providers
            : vercelIndex === -1
              ? [...entry.providers, ATLAS_CLOUD_PROVIDER_ID]
              : [
                  ...entry.providers.slice(0, vercelIndex),
                  ATLAS_CLOUD_PROVIDER_ID,
                  ...entry.providers.slice(vercelIndex),
                ]
          return {
            ...entry,
            providers,
          }
        }),
        ...(requirement.requiresProvider && requirement.requiresProvider.some((provider) =>
          requirement.fallbackChain.some((entry) =>
            entry.providers.includes(provider) && ATLAS_CLOUD_SUPPORTED_MODELS.has(entry.model)
          )
        ) ? { requiresProvider: [...requirement.requiresProvider, ATLAS_CLOUD_PROVIDER_ID] } : {}),
      },
    ]),
  )
}

export const CLI_AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = withAtlasCloudProvider(AGENT_MODEL_REQUIREMENTS)

export const CLI_CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = withAtlasCloudProvider(CATEGORY_MODEL_REQUIREMENTS)
