import type { ProbeResult } from "./types"

/**
 * Probe a model via live API call to check availability.
 * Returns shouldFallback=true for quota/auth errors (429, 403, 401).
 */
export async function probeModelViaApi(
  client: any,
  model: string
): Promise<ProbeResult> {
  try {
    if (!client?.provider?.list) {
      return {
        ok: false,
        model,
        error: "client.provider.list not available",
        shouldFallback: false
      }
    }

    const result = await client.provider.list()
    const allProviders = result.data?.all ?? []
    
    const parts = model.split("/")
    const providerId = parts[0]
    const modelId = parts.slice(1).join("/")
    
    if (!providerId || !modelId) {
      return {
        ok: false,
        model,
        error: `Invalid model format: ${model}`,
        shouldFallback: false
      }
    }

    const provider = allProviders.find((p: any) => p?.id === providerId)
    if (!provider?.models || typeof provider.models !== "object") {
      return {
        ok: false,
        model,
        error: `Provider ${providerId} not found or no models available`,
        shouldFallback: false
      }
    }

    const modelIds = Object.keys(provider.models)
    if (!modelIds.includes(modelId)) {
      return {
        ok: false,
        model,
        error: `Model ${model} not found in provider ${providerId}`,
        shouldFallback: false
      }
    }

    return { ok: true, model }
  } catch (error) {
    const errMsg = String(error instanceof Error ? error.message : error).toLowerCase()
    
    const isQuotaError = 
      errMsg.includes("429") ||
      errMsg.includes("rate limit") ||
      errMsg.includes("quota") ||
      errMsg.includes("exceeded") ||
      errMsg.includes("usage limit")
    
    const isAuthError =
      errMsg.includes("403") ||
      errMsg.includes("401") ||
      errMsg.includes("unauthorized") ||
      errMsg.includes("authentication") ||
      errMsg.includes("invalid key")
    
    return {
      ok: false,
      model,
      error: errMsg,
      shouldFallback: isQuotaError || isAuthError
    }
  }
}

/**
 * Run live API probes for all configured models.
 * Only reports issues - no config mutation.
 */
export async function runLiveProbes(
  client: any,
  models: string[]
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  
  for (const model of models) {
    const result = await probeModelViaApi(client, model)
    results.push(result)
    
    // Stop on non-fallback errors to avoid spamming
    if (!result.ok && !result.shouldFallback) {
      break
    }
  }
  
  return results
}
