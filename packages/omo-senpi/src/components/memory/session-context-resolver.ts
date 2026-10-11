import { isAbsolute } from "node:path"

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

/**
 * The agent state directory the ENGINE resolved for this session, as reported by the host.
 *
 * The adapter's own `resolveAgentHome` detection cannot reproduce that answer: the engine reads
 * its brand env prefix before the legacy ones, then walks up from the parent's cwd looking for a
 * project config dir, and only then falls back to a home default. A re-derived directory is what
 * leaves the reflection child locking its credentials outside the sandbox grant.
 *
 * The host exposes it as a getter that throws once its runner is stale, and the reflection sandbox
 * is built lazily at launch - long after the handler that produced this context returned - so the
 * read is guarded and an unusable context answers `undefined` instead of failing the launch.
 */
export function resolveSessionAgentDir(eventContext: unknown): string | undefined {
  if (!isRecord(eventContext)) return undefined
  let agentDir: unknown
  try {
    agentDir = eventContext.agentDir
  } catch {
    return undefined
  }
  if (typeof agentDir !== "string") return undefined
  const trimmed = agentDir.trim()
  return trimmed.length > 0 && isAbsolute(trimmed) ? trimmed : undefined
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
