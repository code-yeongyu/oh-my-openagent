import {
  MODEL_PROVIDERS,
  ModelProviderSchema,
  type ModelProvider,
  type ProviderModelsConfig,
} from "../config/schema/provider-models"
import { parseModelString } from "./model-string-parser"

export type ProviderModelPinKind = "agents" | "categories"

export type PinnedModel = {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

export type ProviderModelPinResolution = { readonly model: PinnedModel } | { readonly error: string }

const TARGET_LABEL: Record<ProviderModelPinKind, string> = { agents: "agent", categories: "category" }

/** The `provider` tool argument: omitted is undefined, anything but a known provider throws. */
export function parseProviderArgument(value: unknown): ModelProvider | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const parsed = ModelProviderSchema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new Error(
    `Invalid arguments: provider must be one of ${MODEL_PROVIDERS.join(", ")}; got ${JSON.stringify(value)}.`,
  )
}

export function hasProviderModelPins(config: ProviderModelsConfig | undefined): boolean {
  return Boolean(config?.openai || config?.anthropic)
}

export function resolveProviderModelPin(
  config: ProviderModelsConfig | undefined,
  provider: ModelProvider,
  kind: ProviderModelPinKind,
  key: string,
): ProviderModelPinResolution {
  const pinKey = `provider_models.${provider}.${kind}.${key}`
  const pinSet = config?.[provider]
  if (!pinSet) {
    return {
      error: `provider "${provider}" has no pin set: add provider_models.${provider} to the [opencode] block of your omo.jsonc, or call without provider. Not falling back to another provider.`,
    }
  }

  const pin = pinSet[kind]?.[key]
  if (!pin) {
    return {
      error: `provider "${provider}" has no pin for ${TARGET_LABEL[kind]} "${key}": add ${pinKey} = { "model": "<provider>/<model>", "variant": "<optional>" } to your omo.jsonc, or call without provider. Not falling back to another provider.`,
    }
  }

  const parsed = parseModelString(pin.model)
  if (!parsed) {
    return { error: `${pinKey}.model "${pin.model}" is not a provider/model id.` }
  }

  const variant = pin.variant ?? parsed.variant
  return {
    model: {
      providerID: parsed.providerID,
      modelID: parsed.modelID,
      ...(variant ? { variant } : {}),
    },
  }
}
