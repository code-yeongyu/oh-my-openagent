import type { ProbeProvider, ProviderCredentials } from "./provider-types"
import type { ProbeStore } from "../sqlite-store"
import { createDs2ApiProvider } from "./ds2api-provider"
import { createOpenAIOfficialProvider } from "./openai-official-provider"
import { createAnthropicOfficialProvider } from "./anthropic-official-provider"
import { createDeepSeekWebProvider } from "./deepseek-web-provider"
import { createGeminiOfficialProvider } from "./gemini-official-provider"
import { createOpencodeGoProvider } from "./opencode-go-provider"
import { createOpenRouterProvider } from "./openrouter-provider"
import { createOllamaLocalProvider } from "./ollama-local-provider"
import { createClaudeWebReverseProvider } from "./claude-web-reverse-provider"
import { createGeminiWebReverseProvider } from "./gemini-web-reverse-provider"
import { createManusWebProvider } from "./manus-web-provider"

export type ProviderRegistry = ReturnType<typeof createProviderRegistry>

export type ProviderHealthSummary = {
  total_providers: number
  active_providers: number
  degraded_providers: number
  unknown_providers: number
}

const PROVIDER_FACTORIES: Record<string, (creds: ProviderCredentials) => ProbeProvider> = {
  ds2api: createDs2ApiProvider,
  openai_official: createOpenAIOfficialProvider,
  anthropic_official: createAnthropicOfficialProvider,
  deepseek_web: createDeepSeekWebProvider,
  gemini_official: createGeminiOfficialProvider,
  opencode_go: createOpencodeGoProvider,
  openrouter: createOpenRouterProvider,
  ollama_local: createOllamaLocalProvider,
  claude_web_reverse: createClaudeWebReverseProvider,
  gemini_web_reverse: createGeminiWebReverseProvider,
  manus_web: createManusWebProvider,
}

export function createProviderRegistry(args: { store: ProbeStore }) {
  const providers = new Map<string, ProbeProvider>()

  function loadAll(): { loaded: number; skipped: number } {
    providers.clear()
    let loaded = 0
    let skipped = 0
    for (const creds of args.store.listProviders()) {
      const factory = PROVIDER_FACTORIES[creds.provider_type]
      if (!factory) {
        skipped++
        continue
      }
      providers.set(creds.id, factory(creds))
      loaded++
    }
    return { loaded, skipped }
  }

  function get(id: string): ProbeProvider | null {
    if (!providers.has(id)) {
      const creds = args.store.getProvider(id)
      if (!creds) return null
      const factory = PROVIDER_FACTORIES[creds.provider_type]
      if (!factory) return null
      providers.set(id, factory(creds))
    }
    return providers.get(id) ?? null
  }

  function list(): ProbeProvider[] {
    return Array.from(providers.values())
  }

  function supportedProviderTypes(): ReadonlyArray<string> {
    return Object.keys(PROVIDER_FACTORIES)
  }

  function getHealthSummary(): ProviderHealthSummary {
    const all = args.store.listProviders()
    let active = 0
    let degraded = 0
    let unknown = 0
    for (const p of all) {
      if (p.status === "active") active++
      else if (p.status === "degraded") degraded++
      else unknown++
    }
    return {
      total_providers: all.length,
      active_providers: active,
      degraded_providers: degraded,
      unknown_providers: unknown,
    }
  }

  return { loadAll, get, list, supportedProviderTypes, getHealthSummary }
}
