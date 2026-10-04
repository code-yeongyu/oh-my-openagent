import { resolveMemoryRoot } from "@oh-my-opencode/memory-core"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { GatewayRulesStore } from "./prompt"
import { GATEWAY_RULES_EXTENSION_NAME } from "./store-extension/migrations"
import type { ScopeMember } from "./store-extension/scope-members"
import { resolveScopeMemoryIdentity } from "./scope-identity"

export interface GatewayScopeAccess {
  readonly member: (sessionId: string) => Promise<ScopeMember | null>
  readonly identity: (member: ScopeMember, cwd: string) => ReturnType<typeof resolveScopeMemoryIdentity> | undefined
  /** An internal gateway_rules op run AS `sessionId`: the store stamps it as the caller. */
  readonly callAs: <T>(sessionId: string, op: string, args: unknown) => Promise<T>
  readonly memoryHome: (cwd: string) => string
}

export function createGatewayScopeAccess(
  ensureStore: () => Promise<GatewayRulesStore | undefined>,
  env: Record<string, string | undefined> = process.env,
): GatewayScopeAccess {
  const memoryHome = resolveMemoryRoot(env, resolveAgentHome({ env }))
  const callAs = async <T>(sessionId: string, op: string, args: unknown): Promise<T> => {
    const store = await ensureStore()
    if (store === undefined) throw new Error("gateway scope store is unavailable")
    const result = await store.extensionSessionAwait<T>(GATEWAY_RULES_EXTENSION_NAME, op, args, { callerDurableId: sessionId })
    if (result.kind !== "ok") throw new Error(`gateway scope operation refused: ${result.message}`)
    return result.value
  }
  return {
    callAs,
    member: async (sessionId) => {
      const store = await ensureStore()
      if (store === undefined) return null
      return callAs<ScopeMember | null>(sessionId, "memberForSession", {})
    },
    identity: (member, cwd) => member.memory_identity === null
      ? undefined
      : resolveScopeMemoryIdentity(member.scope, member.memory_identity, memoryHome, cwd),
    memoryHome: () => memoryHome,
  }
}

export function gatewaySessionId(eventCtx: unknown): string | undefined {
  if (eventCtx === null || typeof eventCtx !== "object") return undefined
  const manager = Reflect.get(eventCtx, "sessionManager")
  if (manager === null || typeof manager !== "object") return undefined
  const getSessionId = Reflect.get(manager, "getSessionId")
  if (typeof getSessionId !== "function") return undefined
  const id: unknown = Reflect.apply(getSessionId, manager, [])
  return typeof id === "string" && id.length > 0 ? id : undefined
}
