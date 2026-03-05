export type ProbeResult = 
  | { ok: true; model: string }
  | { ok: false; model: string; error: string; shouldFallback: boolean }

/**
 * Probe a model with a minimal request to check if it's available.
 * Returns shouldFallback=true for quota/auth errors (429, 403, 401).
 */
export async function probeModel(
  client: any,
  model: string
): Promise<ProbeResult> {
  try {
    // Try to list models as a lightweight probe
    if (client?.model?.list) {
      const result = await client.model.list()
      const models = result.data ?? []
      const found = models.find((m: any) => 
        m?.provider && m?.id && `${m.provider}/${m.id}` === model
      )
      
      if (found) {
        return { ok: true, model }
      }
    }
    
    return { ok: true, model }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    const isQuotaError = 
      errMsg.includes("429") ||
      errMsg.includes("rate limit") ||
      errMsg.includes("quota") ||
      errMsg.includes("exceeded")
    
    const isAuthError =
      errMsg.includes("403") ||
      errMsg.includes("401") ||
      errMsg.includes("unauthorized") ||
      errMsg.includes("authentication")
    
    return {
      ok: false,
      model,
      error: errMsg,
      shouldFallback: isQuotaError || isAuthError
    }
  }
}

/**
 * Probe multiple models and return the first working one
 */
export async function findWorkingModel(
  client: any,
  models: string[]
): Promise<{ model: string | undefined; probes: ProbeResult[] }> {
  const probes: ProbeResult[] = []
  
  for (const model of models) {
    const result = await probeModel(client, model)
    probes.push(result)
    
    if (result.ok) {
      return { model, probes }
    }
    
    // If it's not a fallback-able error, stop trying
    if (!result.shouldFallback) {
      break
    }
  }
  
  return { model: undefined, probes }
}
