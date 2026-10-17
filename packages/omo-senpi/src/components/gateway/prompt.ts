import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"

import type { StoreExtensionResult } from "../thread/gateway/store-extensions"
import { composeGatewayRulesBlock } from "./rules-block"
import { GATEWAY_RULES_EXTENSION_NAME } from "./store-extension/migrations"

export interface GatewayRulesStore {
  readonly extensionCall: <T = unknown>(name: string, op: string, args: unknown) => Promise<StoreExtensionResult<T>>
}

export interface GatewayRulesPromptOptions {
  /**
   * Lazily connects the gateway store on first need: a session without the gateway config, or a
   * host without the store database, resolves undefined forever and this handler is a pass-through.
   */
  readonly ensureStore: () => Promise<GatewayRulesStore | undefined>
  readonly onLookupError?: (message: string) => void
}

/**
 * Per-turn rules injection via `before_agent_start`. Only a session with a committed block row
 * (the scope lead, or a session with an active binding) changes the prompt; every other session
 * returns undefined, so the host passes the assembled prompt through byte-identical.
 */
export function createGatewayRulesPromptHandler(
  options: GatewayRulesPromptOptions,
): (payload: unknown, eventCtx?: unknown) => Promise<BeforeAgentStartEventResult | undefined> {
  let lookupWarned = false
  return async (payload, eventCtx) => {
    const systemPrompt = readSystemPrompt(payload)
    if (systemPrompt === undefined) return undefined
    const sessionId = readSessionId(eventCtx)
    if (sessionId === undefined) return undefined
    const store = await options.ensureStore()
    if (store === undefined) return undefined
    const result = await store.extensionCall<{ readonly version: string; readonly block: string } | null>(
      GATEWAY_RULES_EXTENSION_NAME,
      "blockForSession",
      { session_durable_id: sessionId },
    )
    if (result.kind !== "ok") {
      if (!lookupWarned) {
        lookupWarned = true
        options.onLookupError?.(`gateway rules lookup failed: ${result.message}`)
      }
      return undefined
    }
    if (result.value === null) return undefined
    return { systemPrompt: composeGatewayRulesBlock(systemPrompt, result.value.block) }
  }
}

function readSystemPrompt(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  if (payload.type !== "before_agent_start") return undefined
  return typeof payload.systemPrompt === "string" ? payload.systemPrompt : undefined
}

function readSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx)) return undefined
  const manager = isRecord(eventCtx.sessionManager) ? eventCtx.sessionManager : undefined
  const getSessionId = manager?.getSessionId
  if (typeof getSessionId !== "function") return undefined
  const id = Reflect.apply(getSessionId, manager, [])
  return typeof id === "string" && id.length > 0 ? id : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
