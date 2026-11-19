import { z } from "zod"

export const MODEL_PROVIDERS = ["openai", "anthropic"] as const

export const ModelProviderSchema = z.enum(MODEL_PROVIDERS)

const ProviderModelPinSchema = z
  .object({
    model: z
      .string()
      .regex(/^[^/\s]+\/\S+$/, "expected provider/model")
      .describe("Model id as provider/model, for example openai/gpt-6.1-sol."),
    variant: z.string().optional().describe("Model variant (reasoning level), for example high. Omitted: none."),
  })
  .strict()

const ProviderModelPinMapSchema = z.record(z.string(), ProviderModelPinSchema)

const ProviderModelSetSchema = z
  .object({
    agents: ProviderModelPinMapSchema.optional().describe(
      "Agent name (sisyphus-junior, multimodal-looker, explore, librarian, oracle, ...) to the model task(subagent_type=...) and look_at use when this provider is requested.",
    ),
    categories: ProviderModelPinMapSchema.optional().describe(
      "Category name (quick, deep-low, writing, ...) to the model task(category=...) uses when this provider is requested.",
    ),
  })
  .strict()

export const ProviderModelsConfigSchema = z
  .object({
    openai: ProviderModelSetSchema.optional().describe(
      'Pins used when look_at or task is called with provider="openai".',
    ),
    anthropic: ProviderModelSetSchema.optional().describe(
      'Pins used when look_at or task is called with provider="anthropic".',
    ),
  })
  .strict()
  .describe(
    "Per-provider pin sets for the provider argument of look_at and task. A call that passes provider uses only that set: its pin replaces agent/category models, fallback chains and runtime model overrides, and a missing pin fails the call instead of falling back to another provider. Calls without provider are unaffected.",
  )

export type ModelProvider = z.infer<typeof ModelProviderSchema>
export type ProviderModelPin = z.infer<typeof ProviderModelPinSchema>
export type ProviderModelsConfig = z.infer<typeof ProviderModelsConfigSchema>
