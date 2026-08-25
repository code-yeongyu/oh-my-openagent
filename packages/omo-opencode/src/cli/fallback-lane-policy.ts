const EXCLUDED_FALLBACK_PROVIDERS = new Set(["openrouter", "opencode", "vercel"])

export function isExcludedFallbackLaneModel(model: string): boolean {
  const slashIndex = model.indexOf("/")
  if (slashIndex <= 0) return false
  return EXCLUDED_FALLBACK_PROVIDERS.has(model.slice(0, slashIndex).toLowerCase())
}
