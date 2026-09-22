import { homedir } from "node:os"

import { createProvider, type Model } from "@earendil-works/pi-ai"
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { hasOpenferenceCredential } from "./auth"
import catalogJson from "./openference-senpi-models.json"
import type { OpenferenceSenpiCatalog } from "./types"

export { hasOpenferenceCredential } from "./auth"
export const OPENFERENCE_PROVIDER_COMPONENT_NAME = "openference-provider"
export const OPENFERENCE_PROVIDER_ID = "openference"
export const OPENFERENCE_BASE_URL = "https://api.openference.com/v1"
export const OPENFERENCE_ENV_VAR = "OPENFERENCE_API_KEY"

/** Openference rejects requests without a pi/ User-Agent with 403 "coding agent required". */
export const OPENFERENCE_USER_AGENT = "pi/openference"

// The generated catalog is a JSON array of Pi model entries; the JSON import's
// inferred shape crosses the boundary once, like any external payload.
const catalog = catalogJson as unknown as OpenferenceSenpiCatalog

function toProviderModels(): readonly Model<"openai-completions">[] {
  return catalog.map((entry) => ({
    id: entry.id,
    name: entry.name,
    api: "openai-completions" as const,
    provider: OPENFERENCE_PROVIDER_ID,
    baseUrl: OPENFERENCE_BASE_URL,
    reasoning: entry.reasoning,
    input: [...entry.input],
    cost: { ...entry.cost },
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
    ...(entry.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: { ...entry.thinkingLevelMap } }),
  }))
}

export interface OpenferenceProviderComponentOptions {
  /** Overrides agent-home resolution; tests point it at a temp dir holding auth.json. */
  readonly agentDir?: string
  readonly env?: Record<string, string | undefined>
  readonly homeDir?: string
}

/**
 * Credential-gated IN-MEMORY registration of the Openference provider through
 * `pi.registerProvider(createProvider(...))` — no user-config mutation, so
 * nothing of the provider survives the process once the credential is gone.
 *
 * The gate mirrors x-search: registration happens at EXTENSION LOAD, and without
 * a credential (`OPENFERENCE_API_KEY` env var or an `openference` login entry in
 * `<agentDir>/auth.json`) nothing is registered at all. REQUEST auth is owned by
 * the engine: `auth.apiKey.resolve` merges the stored `/login` credential with
 * the env var per field (`credential.key ?? env`), so both credential paths work
 * identically and no key value ever lands in config.
 *
 * The provider carries the required `User-Agent: pi/openference` header
 * (Openference 403s without it) and the committed catalog with published
 * context windows, output limits, per-million costs, and thinking level maps.
 */
export function createOpenferenceProviderComponent(
  options: OpenferenceProviderComponentOptions = {},
): OmoSenpiComponent {
  const env = options.env ?? process.env

  return {
    name: OPENFERENCE_PROVIDER_COMPONENT_NAME,
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const agentDir = options.agentDir ?? resolveAgentHome({ env, homeDir: options.homeDir ?? homedir() })
      if (!hasOpenferenceCredential({ agentDir, env })) {
        // An expected state on machines without Openference credentials: debug
        // channel only, like x-search's skip path.
        ctx.logger.debug?.("openference-provider skipped: no credential", {
          component: OPENFERENCE_PROVIDER_COMPONENT_NAME,
        })
        return
      }
      if (pi.registerProvider === undefined) {
        // Feature detection, not a hard failure: hosts older than the release
        // that added provider registration keep working without the provider.
        ctx.logger.warn("openference-provider skipped: host has no registerProvider", {
          component: OPENFERENCE_PROVIDER_COMPONENT_NAME,
        })
        return
      }

      pi.registerProvider(
        createProvider({
          id: OPENFERENCE_PROVIDER_ID,
          name: "Openference",
          baseUrl: OPENFERENCE_BASE_URL,
          headers: { "User-Agent": OPENFERENCE_USER_AGENT },
          auth: {
            apiKey: {
              name: "Openference API key",
              login: async (interaction) => ({
                type: "api_key" as const,
                key: await interaction.prompt({
                  type: "secret",
                  message: "Openference API key (https://openference.com)",
                }),
              }),
              resolve: async ({ credential, ctx: authCtx }) => {
                const stored = credential?.key?.trim()
                if (stored !== undefined && stored.length > 0) {
                  return { auth: { apiKey: stored }, source: "stored API key" }
                }
                const ambient = (await authCtx.env(OPENFERENCE_ENV_VAR))?.trim()
                if (ambient !== undefined && ambient.length > 0) {
                  return { auth: { apiKey: ambient }, source: OPENFERENCE_ENV_VAR }
                }
                return undefined
              },
            },
          },
          models: toProviderModels(),
          api: openAICompletionsApi(),
        }),
      )
      ctx.logger.debug?.(`openference-provider registered: ${catalog.length} models`, {
        component: OPENFERENCE_PROVIDER_COMPONENT_NAME,
      })
    },
  }
}
