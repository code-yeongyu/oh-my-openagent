import type { KibitzerBufferedReason, KibitzerOfferResult } from "./sidecar-contract"
import type { KibitzerWakeOutcome, KibitzerWakeStatus } from "./sidecar-outcome"

/**
 * Counts only, by construction: the nudge PATHS and HINTS a wake produced stay inside the memory
 * component, so an observer cannot export a user's private memory corpus even by mistake.
 */
export type KibitzerTelemetrySignal =
  | {
    readonly kind: "wake"
    readonly sessionId: string
    readonly wake: number
    readonly generation: number
    readonly status: KibitzerWakeStatus
    readonly nudges: number
    readonly candidateCount: number
    readonly toolCalls: number
    readonly durationMs: number
    readonly slotWaitMs: number
    readonly model?: string
    readonly usage?: {
      readonly input: number
      readonly output: number
      readonly cacheRead: number
      readonly cacheWrite: number
    }
  }
  | {
    readonly kind: "offer"
    readonly sessionId: string
    readonly action: KibitzerOfferResult["action"]
    readonly reason?: KibitzerBufferedReason
  }

export type KibitzerTelemetryObserver = (signal: KibitzerTelemetrySignal) => void

export interface KibitzerTelemetryObservers {
  readonly subscribe: (observer: KibitzerTelemetryObserver) => () => void
  readonly notify: (signal: KibitzerTelemetrySignal) => void
}

// Same reason as the task terminal-observer ledger: senpi re-registers every component on a session
// switch and packaged extensions load through an uncached importer, so a module-scope Set would
// leave the memory component notifying one evaluation's set while telemetry subscribed to another.
export const KIBITZER_TELEMETRY_OBSERVERS_KEY = Symbol.for("omo.kibitzer.telemetryObservers")

export function createKibitzerTelemetryObservers(onObserverError?: (error: unknown) => void): KibitzerTelemetryObservers {
  const observers = new Set<KibitzerTelemetryObserver>()
  return {
    subscribe: (observer) => {
      observers.add(observer)
      return () => {
        observers.delete(observer)
      }
    },
    notify: (signal) => {
      for (const observer of observers) {
        try {
          observer(signal)
        } catch (error) {
          // A wake must settle even when a telemetry observer throws.
          onObserverError?.(error)
        }
      }
    },
  }
}

function isObserverLedger(value: unknown): value is KibitzerTelemetryObservers {
  if (typeof value !== "object" || value === null) return false
  const candidate: Partial<KibitzerTelemetryObservers> = value
  return typeof candidate.subscribe === "function" && typeof candidate.notify === "function"
}

export function sharedKibitzerTelemetryObservers(): KibitzerTelemetryObservers {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const existing = registry[KIBITZER_TELEMETRY_OBSERVERS_KEY]
  if (isObserverLedger(existing)) return existing
  const created = createKibitzerTelemetryObservers()
  registry[KIBITZER_TELEMETRY_OBSERVERS_KEY] = created
  return created
}

export function kibitzerOfferSignal(sessionId: string, result: KibitzerOfferResult): KibitzerTelemetrySignal {
  return {
    kind: "offer",
    sessionId,
    action: result.action,
    ...(result.action === "buffered" ? { reason: result.reason } : {}),
  }
}

export function kibitzerWakeSignal(outcome: KibitzerWakeOutcome): KibitzerTelemetrySignal {
  return {
    kind: "wake",
    sessionId: outcome.sessionId,
    wake: outcome.wake,
    generation: outcome.generation,
    status: outcome.status,
    nudges: outcome.nudges.length,
    candidateCount: outcome.candidateCount,
    toolCalls: outcome.toolCalls,
    durationMs: outcome.durationMs,
    slotWaitMs: outcome.slotWaitMs,
    ...(outcome.model === undefined ? {} : { model: outcome.model }),
    ...(outcome.usage === undefined ? {} : { usage: { ...outcome.usage } }),
  }
}
