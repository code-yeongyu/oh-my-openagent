export type ResolveResult = {
  changed: boolean
  from?: string
  to?: string
  reason?: "missing" | "provider_disconnected" | "live_probe_failed"
}

export type ResolveOptions = {
  preferred: string | undefined
  fallbacks: (string | undefined)[]
  available: Set<string>
}

/**
 * Resolve a model with fallback chain.
 * Returns the first available model from the chain.
 */
export function resolveModel(options: ResolveOptions): { model: string | undefined; result: ResolveResult } {
  const { preferred, fallbacks, available } = options
  
  // Build chain: preferred first, then fallbacks, filtered for valid strings
  const chain = [preferred, ...fallbacks].filter((m): m is string => 
    typeof m === "string" && m.length > 0
  )

  // If preferred is available, use it
  if (preferred && available.has(preferred)) {
    return { 
      model: preferred, 
      result: { changed: false } 
    }
  }

  // Find first available fallback
  const availableFallback = chain.find(m => available.has(m))
  
  if (availableFallback) {
    return {
      model: availableFallback,
      result: {
        changed: preferred !== availableFallback,
        from: preferred,
        to: availableFallback,
        reason: "missing"
      }
    }
  }

  // Nothing available - return preferred (will fail later, but that's expected)
  return {
    model: preferred,
    result: { changed: false }
  }
}
