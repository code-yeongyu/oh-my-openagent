import { getProbeLabContext } from "../probe-lab-context"
import { createDeepSeekWebProvider } from "../providers/deepseek-web-provider"
import type { ProbeProvider, ProviderCredentials } from "../providers/provider-types"

const DEFAULT_PROVIDER_ID = "deepseek-web"
const PROVIDER_ID_ENV = "IDM_OPENAI_COMPAT_PROVIDER_ID"
const PROVIDER_IDS_ENV = "IDM_OPENAI_COMPAT_PROVIDER_IDS"

export type LoadedProvider = {
  provider: ProbeProvider
  baseUrl: string
  creds: ProviderCredentials
}

export type ProviderStoreLike = {
  getProvider: (id: string) => ProviderCredentials | null
}

let cached: LoadedProvider | null = null
let cachedMulti: LoadedProvider[] | null = null

export function selectDeepSeekProvider(
  store: ProviderStoreLike,
  providerId: string,
): LoadedProvider {
  const creds = store.getProvider(providerId)
  if (!creds) {
    throw new Error(
      `probe-lab provider not found: ${providerId} (register via probe_provider_register first)`,
    )
  }
  if (creds.provider_type !== "deepseek_web") {
    throw new Error(
      `provider ${providerId} is not deepseek_web (got ${creds.provider_type})`,
    )
  }
  return {
    provider: createDeepSeekWebProvider(creds),
    baseUrl: creds.base_url,
    creds,
  }
}

export function loadDeepSeekProvider(opts?: {
  providerId?: string
  store?: ProviderStoreLike
}): LoadedProvider {
  if (cached) return cached
  const providerId =
    opts?.providerId ?? process.env[PROVIDER_ID_ENV] ?? DEFAULT_PROVIDER_ID
  const store = opts?.store ?? getProbeLabContext().store
  const loaded = selectDeepSeekProvider(store, providerId)
  cached = loaded
  return loaded
}

export function resolveProviderIds(opts?: {
  providerIds?: ReadonlyArray<string>
}): string[] {
  if (opts?.providerIds && opts.providerIds.length > 0) {
    return [...opts.providerIds]
  }
  const fromMulti = process.env[PROVIDER_IDS_ENV]
  if (typeof fromMulti === "string" && fromMulti.length > 0) {
    return fromMulti
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  const single = process.env[PROVIDER_ID_ENV]
  if (typeof single === "string" && single.length > 0) return [single]
  return [DEFAULT_PROVIDER_ID]
}

export function loadDeepSeekProviders(opts?: {
  providerIds?: ReadonlyArray<string>
  store?: ProviderStoreLike
}): LoadedProvider[] {
  if (cachedMulti) return cachedMulti
  const ids = resolveProviderIds(opts)
  const store = opts?.store ?? getProbeLabContext().store
  const loaded: LoadedProvider[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    loaded.push(selectDeepSeekProvider(store, id))
  }
  cachedMulti = loaded
  return loaded
}

export function resetProviderCacheForTests(): void {
  cached = null
  cachedMulti = null
}
