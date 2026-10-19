import { log } from "./logger"

// OMO-internal capability bridge, not a speculative property on the host API.
const nativePluginLookups = new WeakMap<object, () => Promise<unknown>>()

export function withNativePluginLookup<T extends object>(input: T, lookup?: () => Promise<unknown>): T {
  if (lookup) nativePluginLookups.set(input, lookup)
  return input
}

export async function hasActiveNativeContextMode(input: object): Promise<boolean> {
  const lookup = nativePluginLookups.get(input)
  if (!lookup) return false
  try {
    const result = await lookup() as { data?: Array<{ id?: string; state?: { status?: string } }> }
    return Array.isArray(result?.data) && result.data.some(
      (plugin) => plugin.id === "context-mode" && plugin.state?.status === "active",
    )
  } catch (error) {
    log("[claude-code-hooks] native plugin lookup failed; preserving prompt bridge", {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
