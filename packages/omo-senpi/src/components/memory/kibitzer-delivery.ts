import { renderNudgeBlock, type RecallLedger, type RecallNudge, type PendingNudges } from "@oh-my-opencode/memory-core"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { ComponentLogger } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { GATE_SURFACE_HASH } from "./recall-drain"
import { NUDGED_ENTRY_TYPE, type KibitzerNudgedRecord } from "./kibitzer-notice"
import { RECALL_CUSTOM_TYPE } from "./recall-session-read"

export interface KibitzerDeliveryOptions {
  readonly ledgerFor: (context: MemoryIdentityContext) => RecallLedger
  readonly pendingFor: (context: MemoryIdentityContext) => Pick<PendingNudges, "write" | "delete">
  readonly coordinator?: IdleInjectionCoordinator
  readonly sendMessage: (
    message: { readonly customType: string; readonly content: string; readonly display: false },
    options: { readonly deliverAs: "steer" },
  ) => unknown
  readonly appendEntry: (customType: string, data: unknown) => void
  readonly logger?: ComponentLogger
}

export interface KibitzerDelivery {
  markRunning(sessionId: string): void
  markSettled(sessionId: string): void
  accept(sessionId: string, context: MemoryIdentityContext, nudges: readonly RecallNudge[], epoch: number): Promise<void>
  onToolResult(sessionId: string, context: MemoryIdentityContext, eventCtx: unknown): Promise<void>
  drainForPrompt(sessionId: string, context: MemoryIdentityContext): RecallNudge[]
  onCompactionAccepted(sessionId: string, context: MemoryIdentityContext): Promise<void>
  onSessionShutdown(sessionId: string): void
  markDelivered(sessionId: string, context: MemoryIdentityContext, paths: readonly string[], via: "steer" | "wake" | "prompt"): Promise<void>
}

interface DeliveryState {
  readonly nudges: Map<string, RecallNudge>
  readonly coordinatorKeys: Set<string>
  epoch: number
  steering: boolean
}

export function createKibitzerDelivery(options: KibitzerDeliveryOptions): KibitzerDelivery {
  const sessions = new Map<string, DeliveryState>()
  const runningSessions = new Set<string>()

  function stateFor(sessionId: string): DeliveryState {
    const existing = sessions.get(sessionId)
    if (existing !== undefined) return existing
    const created: DeliveryState = { nudges: new Map(), coordinatorKeys: new Set(), epoch: 0, steering: false }
    sessions.set(sessionId, created)
    return created
  }

  function removeCoordinatorEntries(state: DeliveryState): void {
    if (options.coordinator === undefined) return
    for (const key of state.coordinatorKeys) options.coordinator.remove(key)
    state.coordinatorKeys.clear()
  }

  async function accept(sessionId: string, context: MemoryIdentityContext, nudges: readonly RecallNudge[], epoch: number): Promise<void> {
    try {
      await options.ledgerFor(context).markSurfaced(sessionId, nudges.map((nudge) => ({ path: nudge.path, hash: GATE_SURFACE_HASH })))
    } catch (error) {
      warn("omo-senpi kibitzer delivery ledger mark skipped", { sessionId, error })
    }

    const state = stateFor(sessionId)
    state.epoch = epoch
    for (const nudge of nudges) {
      state.nudges.set(nudge.path, nudge)
      if (options.coordinator === undefined) continue
      const key = `kibitzer:${nudge.path}`
      try {
        options.coordinator.enqueue({
          key,
          source: "kibitzer",
          passive: true,
          customType: NUDGED_ENTRY_TYPE,
          content: renderNudgeBlock(nudge),
          details: { path: nudge.path },
          onFlushed: () => { void markDelivered(sessionId, context, [nudge.path], "wake") },
        })
        state.coordinatorKeys.add(key)
      } catch (error) {
        warn("omo-senpi kibitzer coordinator enqueue skipped", { sessionId, path: nudge.path, error })
      }
    }

    try {
      await writePending(sessionId, context, state)
    } catch (error) {
      warn("omo-senpi kibitzer pending write skipped", { sessionId, error })
    }
    if (runningSessions.has(sessionId) && !state.steering && state.nudges.size > 0) {
      await steer(sessionId, context, state)
    }
  }

  async function onToolResult(sessionId: string, context: MemoryIdentityContext, eventCtx: unknown): Promise<void> {
    const state = sessions.get(sessionId)
    if (state === undefined || state.nudges.size === 0 || state.steering) return
    if (!isRecord(eventCtx) || typeof eventCtx.hasPendingMessages !== "function") return
    if (Reflect.apply(eventCtx.hasPendingMessages, eventCtx, []) !== false) return
    if (typeof eventCtx.isIdle === "function" && Reflect.apply(eventCtx.isIdle, eventCtx, []) === true) return
    await steer(sessionId, context, state)
  }

  async function steer(sessionId: string, context: MemoryIdentityContext, state: DeliveryState): Promise<void> {
    state.steering = true
    try {
      const nudges = [...state.nudges.values()]
      await Promise.resolve(options.sendMessage({ customType: RECALL_CUSTOM_TYPE, content: nudges.map(renderNudgeBlock).join("\n"), display: false }, { deliverAs: "steer" }))
      await markDelivered(sessionId, context, nudges.map((nudge) => nudge.path), "steer")
    } catch (error: unknown) {
      warn("omo-senpi kibitzer steer delivery failed", { sessionId, error: error instanceof Error ? error.message : String(error) })
    } finally {
      state.steering = false
    }
  }

  function drainForPrompt(sessionId: string, _context: MemoryIdentityContext): RecallNudge[] {
    const state = sessions.get(sessionId)
    if (state === undefined) return []
    const nudges = [...state.nudges.values()]
    state.nudges.clear()
    removeCoordinatorEntries(state)
    sessions.delete(sessionId)
    return nudges
  }

  async function onCompactionAccepted(sessionId: string, context: MemoryIdentityContext): Promise<void> {
    runningSessions.delete(sessionId)
    const state = sessions.get(sessionId)
    if (state !== undefined) {
      state.nudges.clear()
      removeCoordinatorEntries(state)
      sessions.delete(sessionId)
    }
    try {
      await options.pendingFor(context).delete(sessionId)
    } catch (error) {
      warn("omo-senpi kibitzer pending delete skipped", { sessionId, error })
    }
  }

  function onSessionShutdown(sessionId: string): void {
    runningSessions.delete(sessionId)
    const state = sessions.get(sessionId)
    if (state === undefined) return
    state.nudges.clear()
    removeCoordinatorEntries(state)
    sessions.delete(sessionId)
  }

  async function markDelivered(sessionId: string, context: MemoryIdentityContext, paths: readonly string[], via: "steer" | "wake" | "prompt"): Promise<void> {
    const state = sessions.get(sessionId)
    if (state === undefined) return
    const delivered: RecallNudge[] = []
    for (const path of paths) {
      const nudge = state.nudges.get(path)
      if (nudge === undefined) continue
      delivered.push(nudge)
      state.nudges.delete(path)
      state.coordinatorKeys.delete(`kibitzer:${path}`)
      options.coordinator?.remove(`kibitzer:${path}`)
    }
    if (delivered.length === 0) return
    try {
      await writePending(sessionId, context, state)
    } catch (error) {
      warn("omo-senpi kibitzer pending rewrite skipped", { sessionId, error })
    }
    try {
      options.appendEntry(NUDGED_ENTRY_TYPE, { version: 1, nudges: delivered, via } satisfies KibitzerNudgedRecord)
    } catch (error) {
      warn("omo-senpi kibitzer nudged entry skipped", { sessionId, error })
    }
    if (state.nudges.size === 0) sessions.delete(sessionId)
  }

  async function writePending(sessionId: string, context: MemoryIdentityContext, state: DeliveryState): Promise<void> {
    const pending = options.pendingFor(context)
    if (state.nudges.size === 0) {
      await pending.delete(sessionId)
      return
    }
    await pending.write(sessionId, [...state.nudges.values()], { epoch: state.epoch })
  }

  function warn(message: string, details: unknown): void {
    options.logger?.warn(message, details)
  }

  return {
    accept, onToolResult, drainForPrompt, onCompactionAccepted, onSessionShutdown, markDelivered,
    markRunning(sessionId): void { runningSessions.add(sessionId) },
    markSettled(sessionId): void { runningSessions.delete(sessionId) },
  }
}

function isRecord(value: unknown): value is Record<string, (...args: never[]) => unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
