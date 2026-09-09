import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { branchEntryCount } from "./wiring-context"
import type { KibitzerDelivery } from "./kibitzer-delivery"
import type { KibitzerTrigger } from "./kibitzer-trigger"

export interface KibitzerHooksOptions {
  readonly trigger: Pick<KibitzerTrigger, "onPrompt" | "onToolCall" | "onSettled">
  readonly delivery: Pick<KibitzerDelivery, "onToolResult" | "markRunning" | "markSettled">
  readonly env: Readonly<Record<string, string | undefined>>
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly resolveSessionId: (eventCtx: unknown) => string | undefined
  readonly logger?: ComponentLogger
  readonly registerSettle?: boolean
}

const CHILD_SENTINELS = ["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS"] as const

export function registerKibitzerHooks(pi: SenpiExtensionAPI, options: KibitzerHooksOptions): void {
  pi.on("before_agent_start", (payload, eventCtx) => {
    try {
      if (!isRecord(payload) || payload.type !== "before_agent_start" || typeof payload.prompt !== "string") return undefined
      if (CHILD_SENTINELS.some((sentinel) => options.env[sentinel] === "1")) return undefined
      const sessionId = options.resolveSessionId(eventCtx)
      if (sessionId !== undefined) options.delivery.markRunning(sessionId)
      options.trigger.onPrompt(payload.prompt, eventCtx)
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi kibitzer prompt trigger failed", { error: describe(error) })
    }
    return undefined
  })

  pi.on("tool_call", (payload, eventCtx) => {
    try {
      options.trigger.onToolCall(payload, eventCtx)
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi kibitzer tool_call trigger failed", { error: describe(error) })
    }
    return undefined
  })

  pi.on("tool_result", async (_payload, eventCtx) => {
    try {
      const sessionId = options.resolveSessionId(eventCtx)
      const context = sessionId === undefined ? undefined : options.resolveContext(sessionId)
      if (sessionId !== undefined && context !== undefined) {
        await options.delivery.onToolResult(sessionId, context, eventCtx)
      }
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi kibitzer tool_result delivery failed", { error: describe(error) })
    }
    return undefined
  })
  pi.on("agent_settled", (_payload, eventCtx) => {
    try {
      const sessionId = options.resolveSessionId(eventCtx)
      if (sessionId !== undefined) options.delivery.markSettled(sessionId)
      if (options.registerSettle !== false && branchEntryCount(eventCtx) > 0) options.trigger.onSettled(eventCtx)
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi kibitzer settle hook failed", { error: describe(error) })
    }
    return undefined
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
