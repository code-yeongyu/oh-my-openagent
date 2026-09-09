import { PendingNudges, RecallLedger } from "@oh-my-opencode/memory-core"

import type { ComponentContext, ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { createKibitzerDelivery, type KibitzerDelivery } from "./kibitzer-delivery"
import { registerKibitzerHooks } from "./kibitzer-hooks"
import { createThrottledPrune } from "./kibitzer-run-retention"
import { createKibitzerTrigger, type KibitzerTrigger } from "./kibitzer-trigger"
import { createKibitzerGateWiring, type KibitzerGateWiring } from "./kibitzer-wiring"
import { sessionIdFrom } from "./wiring-context"
import { resolveMemoryModelRegistry } from "./model-registry-resolver"
import { ToolArgWindow } from "./recall-query-planner-tools"
import type { MemoryRecallWiring } from "./recall-wiring"
import type { MemoryRuntimeWiring } from "./wiring-runtime"
import type { MemoryWiringOptions } from "./wiring-types"

export interface KibitzerComposition {
  readonly gate: KibitzerGateWiring
  readonly delivery: KibitzerDelivery
  readonly trigger: KibitzerTrigger
  registerHooks(pi: SenpiExtensionAPI): void
  onCompactionAccepted(sessionId: string, context: MemoryIdentityContext | undefined): void
  onSessionShutdown(sessionId: string): Promise<void>
}

export function createKibitzerComposition(
  options: MemoryWiringOptions,
  pi: SenpiExtensionAPI,
  runtime: MemoryRuntimeWiring,
  recall: MemoryRecallWiring,
  ctx: ComponentContext,
  logger: ComponentLogger | undefined,
): KibitzerComposition {
  const gate = createKibitzerGateWiring({
    resolveContext: runtime.resolveContext,
    runnerFor: runtime.kibitzerRunnerFor,
    ...(logger === undefined ? {} : { logger }),
  })
  const delivery = createKibitzerDelivery({
    coordinator: ctx.idleCoordinator,
    ledgerFor: (context) => new RecallLedger(context.identityPaths.recallLedger),
    pendingFor: (context) => new PendingNudges(context.identityPaths.recallPending),
    sendMessage: (message, sendOptions) => pi.sendMessage(message, sendOptions),
    appendEntry: (customType, data) => pi.appendEntry?.(customType, data),
    ...(logger === undefined ? {} : { logger }),
  })
  const pruners = new Map<string, () => void>()
  const pruneFor = (recallDir: string): (() => void) => {
    const existing = pruners.get(recallDir)
    if (existing !== undefined) return existing
    const created = createThrottledPrune({
      recallDir,
      now: () => new Date(),
      ...(logger === undefined ? {} : { warn: (message, fields) => logger.warn(message, fields) }),
    })
    pruners.set(recallDir, created)
    return created
  }
  const trigger = createKibitzerTrigger({
    snapshotSession: recall.snapshotSession,
    resolveModelRegistry: (eventCtx) => resolveMemoryModelRegistry(eventCtx),
    collectCandidatesFromSnapshot: recall.collectCandidatesFromSnapshot,
    runnerFor: runtime.kibitzerRunnerFor,
    resolveContext: runtime.resolveContext,
    onAccepted: delivery.accept,
    report: gate.reportOutcome,
    currentCompactionEpoch: gate.currentCompactionEpoch,
    argWindow: new ToolArgWindow(),
    ...(logger === undefined ? {} : { logger }),
  })

  return {
    gate,
    delivery,
    trigger: {
      onPrompt: trigger.onPrompt,
      onToolCall: trigger.onToolCall,
      onSettled(eventCtx): void {
        trigger.onSettled(eventCtx)
        try {
          const sessionId = sessionIdFrom(eventCtx)
          const context = sessionId === undefined ? undefined : runtime.resolveContext(sessionId)
          if (context === undefined) return
          pruneFor(context.identityPaths.recall)()
        } catch (error: unknown) {
          logger?.warn("kibitzer run prune failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
      onCompactionAccepted: trigger.onCompactionAccepted,
      onSessionShutdown: trigger.onSessionShutdown,
      whenIdle: trigger.whenIdle,
    },
    registerHooks(hookPi): void {
      registerKibitzerHooks(hookPi, {
        env: options.env,
        trigger,
        delivery,
        resolveContext: runtime.resolveContext,
        registerSettle: false,
        resolveSessionId: (eventCtx) => {
          const eventRecord = isRecord(eventCtx) ? eventCtx : undefined
          const manager = eventRecord !== undefined && isRecord(eventRecord.sessionManager) ? eventRecord.sessionManager : undefined
          const getter = manager === undefined ? undefined : manager.getSessionId
          if (typeof getter !== "function") return undefined
          const id = Reflect.apply(getter, manager, [])
          return typeof id === "string" && id.length > 0 ? id : undefined
        },
        ...(logger === undefined ? {} : { logger }),
      })
    },
    onCompactionAccepted(sessionId, context): void {
      gate.onCompactionAccepted(sessionId)
      if (context !== undefined) void delivery.onCompactionAccepted(sessionId, context)
      trigger.onCompactionAccepted(sessionId)
    },
    async onSessionShutdown(sessionId): Promise<void> {
      trigger.onSessionShutdown(sessionId)
      await trigger.whenIdle()
      delivery.onSessionShutdown(sessionId)
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
