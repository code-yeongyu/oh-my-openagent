export function resolveParentContextTokens(eventContext: unknown): number | undefined {
  if (!isRecord(eventContext)) return undefined
  const getter = eventContext.getContextUsage
  if (typeof getter !== "function") return undefined
  const usage = Reflect.apply(getter, eventContext, [])
  if (!isRecord(usage)) return undefined
  const tokens = usage.tokens
  return typeof tokens === "number" && tokens > 0 ? tokens : undefined
}

// A fork can only reuse the provider cache if the parent's prefix is actually being cached. The
// observable proof is the session's own usage totals: a non-zero cacheRead means the provider is
// actively caching this session's prefix, so a fork launched inside the TTL stands a chance of
// hitting it. Anything we cannot observe is reported as not cacheable rather than assumed.
export function resolveParentCacheReusable(eventContext: unknown): boolean {
  if (!isRecord(eventContext)) return false
  const manager = eventContext.sessionManager
  if (!isRecord(manager)) return false
  const getter = manager.getUsageTotals
  if (typeof getter !== "function") return false
  const totals = Reflect.apply(getter, manager, [])
  if (!isRecord(totals)) return false
  const cacheRead = totals.cacheRead
  return typeof cacheRead === "number" && cacheRead > 0
}

export function resolveParentSessionFile(eventContext: unknown): string | undefined {
  if (!isRecord(eventContext)) return undefined
  const manager = eventContext.sessionManager
  if (!isRecord(manager)) return undefined
  const getter = manager.getSessionFile
  if (typeof getter !== "function") return undefined
  const file = Reflect.apply(getter, manager, [])
  return typeof file === "string" && file.length > 0 ? file : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
