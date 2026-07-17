import type { PromptAsyncInput } from "./types"

export const LIVE_ROUTE_DISPATCH_LOG = "[live-server-route] dispatch via live listener"
export const LIVE_ROUTE_UNAVAILABLE_LOG = "[live-server-route] route unavailable; using in-process client"

export type PromptDispatchRouteResult = {
  readonly client: unknown
  readonly route: "live" | "in-process"
  readonly reason: "identity" | "flag" | "child" | "unavailable" | "live" | "affinity"
}

export type PromptDispatchRouteResolver = {
  readonly tryResolveDispatchClientSync?: (client: unknown, sessionID: string) => PromptDispatchRouteResult | undefined
  readonly resolveDispatchClient?: (client: unknown, sessionID: string) => Promise<PromptDispatchRouteResult>
  readonly isPreSendConnectionFailure?: (error: unknown) => boolean
  readonly markLiveRouteUnavailable?: (reason: string) => void
}

let routeResolver: PromptDispatchRouteResolver = {}

function identityRoute(client: unknown): PromptDispatchRouteResult {
  return { client, route: "in-process", reason: "identity" }
}

export function configurePromptDispatchRouteResolver(resolver: PromptDispatchRouteResolver | undefined): void {
  routeResolver = resolver ?? {}
}

export function tryResolveDispatchClientSync(client: unknown, sessionID: string): PromptDispatchRouteResult | undefined {
  if (!routeResolver.tryResolveDispatchClientSync) {
    return identityRoute(client)
  }

  return routeResolver.tryResolveDispatchClientSync(client, sessionID)
}

export async function resolveDispatchClient(client: unknown, sessionID: string): Promise<PromptDispatchRouteResult> {
  return routeResolver.resolveDispatchClient?.(client, sessionID) ?? identityRoute(client)
}

export function isPreSendConnectionFailure(error: unknown): boolean {
  return routeResolver.isPreSendConnectionFailure?.(error) ?? false
}

export function markLiveRouteUnavailable(reason: string): void {
  routeResolver.markLiveRouteUnavailable?.(reason)
}

export type _PromptAsyncInputKeepAlive = PromptAsyncInput
