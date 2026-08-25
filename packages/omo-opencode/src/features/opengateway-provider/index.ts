import { isRecord } from "@oh-my-opencode/utils"

import { getProviderAuthType } from "../../shared/opencode-provider-auth"
import catalog from "./opengateway-models.json"

/**
 * Injects OpenGateway into opencode's live config so its models appear without
 * the user hand-writing a provider block.
 *
 * opencode activates every `config.provider` entry regardless of credentials, so
 * the injection is gated on an actual credential: the API key env var, or an
 * `opengateway` entry in opencode's auth.json. Without one, the config is left
 * exactly as it came in.
 */

export const OPENGATEWAY_PROVIDER_ID = "opengateway"
export const OPENGATEWAY_BASE_URL = "https://apis.opengateway.ai/v1"
export const OPENGATEWAY_ENV_VAR = "OPENGATEWAY_API_KEY"

const PROVIDER_NAME = "OpenGateway"
const PROVIDER_NPM = "@ai-sdk/openai-compatible"

function hasCredential(): boolean {
  const apiKey = process.env[OPENGATEWAY_ENV_VAR]
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return true
  }

  return getProviderAuthType(OPENGATEWAY_PROVIDER_ID) !== undefined
}

/** Fills keys absent from `target`; every value the user already set survives. */
function fillMissing(target: Record<string, unknown>, defaults: Record<string, unknown>): void {
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const existing = target[key]
    if (existing === undefined) {
      target[key] = structuredClone(defaultValue)
      continue
    }

    if (isRecord(existing) && isRecord(defaultValue)) {
      fillMissing(existing, defaultValue)
    }
  }
}

export function applyOpenGatewayProviderConfig(config: Record<string, unknown>): void {
  if (!hasCredential()) {
    return
  }

  const existingProviders = config.provider
  const providers: Record<string, unknown> = isRecord(existingProviders) ? existingProviders : {}
  config.provider = providers

  const existingProvider = providers[OPENGATEWAY_PROVIDER_ID]
  const provider: Record<string, unknown> = isRecord(existingProvider) ? existingProvider : {}
  providers[OPENGATEWAY_PROVIDER_ID] = provider

  fillMissing(provider, {
    name: PROVIDER_NAME,
    npm: PROVIDER_NPM,
    env: [OPENGATEWAY_ENV_VAR],
    options: { baseURL: OPENGATEWAY_BASE_URL },
  })

  const existingModels = provider.models
  const models: Record<string, unknown> = isRecord(existingModels) ? existingModels : {}
  provider.models = models

  // A user-defined model id is authoritative as a whole: no field-level merge.
  for (const [modelID, modelConfig] of Object.entries(catalog)) {
    if (models[modelID] !== undefined) continue
    models[modelID] = structuredClone(modelConfig)
  }
}
