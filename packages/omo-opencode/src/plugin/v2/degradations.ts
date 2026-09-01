import { log } from "../../shared/logger"

/**
 * OpenCode V2 dropped several V1 server APIs the OMO internals still call.
 * Each one is warn-once so a busy session does not spam the log, and each
 * facade stub returns the most inert value the call sites already tolerate
 * (they were written against V1 clients that could also be absent in the
 * Desktop sidecar, so every consumer is defensive about these results).
 */
const warned = new Set<string>()

export function warnV2Degraded(feature: string, detail?: string): void {
  if (warned.has(feature)) return
  warned.add(feature)
  log(`[v2-bridge] degraded capability under OpenCode V2: ${feature}${detail ? ` (${detail})` : ""}`)
}

export function resetV2DegradationWarningsForTest(): void {
  warned.clear()
}
