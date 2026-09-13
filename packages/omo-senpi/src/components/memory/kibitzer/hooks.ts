// The resident Kibitzer's hook registrations. Every capture is SYNCHRONOUS: the host disposes the
// event ctx as soon as a handler returns, so the sink must read what it needs (branch, registry,
// payload) before that - the sink never keeps the ctx. `tool_result` captures the result head
// first and only then lets delivery steer a held nudge; `agent_settled` is bookkeeping (the turn
// is over for delivery, the sink refreshes its branch snapshot) and never wakes anything.

import type { ComponentLogger, SenpiExtensionAPI } from "../../../extension/types"
import type { MemoryIdentityContext } from "../context"
import type { KibitzerDelivery } from "./delivery"

/** Where the hooks hand each event, while the ctx is still alive. */
export interface KibitzerHookSink {
  onPrompt(payload: unknown, eventCtx: unknown): void
  onToolCall(payload: unknown, eventCtx: unknown): void
  onToolResult(payload: unknown, eventCtx: unknown): void
  onSettled(eventCtx: unknown): void
}

export interface KibitzerHooksOptions {
  readonly sink: KibitzerHookSink
  readonly delivery: Pick<KibitzerDelivery, "onToolResult" | "markRunning" | "markSettled">
  readonly env: Readonly<Record<string, string | undefined>>
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly resolveSessionId: (eventCtx: unknown) => string | undefined
  readonly logger?: ComponentLogger
}

// A memory worker child (reflection / facts) reasons ABOUT memory; it must never grow a Kibitzer of its own.
const CHILD_SENTINELS = ["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS"] as const

export function registerKibitzerHooks(pi: SenpiExtensionAPI, options: KibitzerHooksOptions): void {
  const isMemoryChild = (): boolean => CHILD_SENTINELS.some((sentinel) => options.env[sentinel] === "1")

  pi.on("before_agent_start", (payload, eventCtx) => {
    try {
      if (!isRecord(payload) || payload.type !== "before_agent_start" || typeof payload.prompt !== "string") return undefined
      if (isMemoryChild()) return undefined
      const sessionId = options.resolveSessionId(eventCtx)
      if (sessionId !== undefined) options.delivery.markRunning(sessionId)
      options.sink.onPrompt(payload, eventCtx)
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi kibitzer prompt capture failed", { error: describe(error) })
    }
    return undefined
  })

  pi.on("tool_call", (payload, eventCtx) => {
    try {
      if (isMemoryChild()) return undefined
      options.sink.onToolCall(payload, eventCtx)
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi kibitzer tool_call capture failed", { error: describe(error) })
    }
    return undefined
  })

  pi.on("tool_result", async (payload, eventCtx) => {
    try {
      if (!isMemoryChild()) options.sink.onToolResult(payload, eventCtx)
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi kibitzer tool_result capture failed", { error: describe(error) })
    }
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
      if (!isMemoryChild()) options.sink.onSettled(eventCtx)
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
