import type { SenpiExtensionAPI } from "../../extension/types"
import type { ToolkitGrant } from "./index"
import { callThreadTool, HOST_TOOL_ROUTE_CHANNEL } from "./thread-tools"

export function callingSessionId(context: unknown): string | undefined {
  if (typeof context !== "object" || context === null || !("sessionManager" in context)) return undefined
  const manager = context.sessionManager
  if (typeof manager !== "object" || manager === null || !("getSessionId" in manager) || typeof manager.getSessionId !== "function") return undefined
  const id: unknown = manager.getSessionId()
  return typeof id === "string" && id.length > 0 ? id : undefined
}

/** Routes are runtime-wide; their grants and shutdown lifetimes belong to one session. */
export function createHostToolRoutes(pi: SenpiExtensionAPI, options: {
  readonly grants: Map<string, ToolkitGrant>
  readonly timeoutMs: number
  readonly onLost: (sessionId: string) => void
}) {
  const owners = new Map<string, { readonly sessionId: string }>()
  function clear(sessionId: string): void {
    for (const [name, owner] of owners) {
      if (owner.sessionId !== sessionId) continue
      owners.delete(name)
      pi.events?.emit(HOST_TOOL_ROUTE_CHANNEL, { name })
    }
    options.grants.delete(`host:${sessionId}`)
  }
  return {
    clear,
    set(name: string, toolName: string, sessionId: string): void {
      const previous = owners.get(name)
      if (previous !== undefined && previous.sessionId !== sessionId) clear(previous.sessionId)
      const owner = { sessionId }
      owners.set(name, owner)
      pi.events?.emit(HOST_TOOL_ROUTE_CHANNEL, {
        name,
        async execute(_id: string, args: Record<string, unknown>, signal?: AbortSignal, _onUpdate?: unknown, callCtx?: unknown) {
          const caller = callingSessionId(callCtx)
          const grant = caller === undefined ? undefined : options.grants.get(`host:${caller}`)
          try {
            return await callThreadTool(grant, toolName, args, options.timeoutMs, signal, true)
          } catch (error) {
            if (error instanceof Error && error.name === "HostToolRouteUnavailable" && owners.get(name) === owner) {
              // senpi drops this route even for a caller without a grant. Invalidate its owner too so discovery can restore it.
              clear(owner.sessionId)
              options.onLost(owner.sessionId)
            }
            throw error
          }
        },
      })
    },
  }
}
