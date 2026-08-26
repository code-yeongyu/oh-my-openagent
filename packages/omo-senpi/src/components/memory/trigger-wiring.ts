// Reflection trigger wiring (plan todo 22): translates senpi run lifecycle events into reflection
// machine evaluations. Compaction is observed only - an accepted session_compact records a pending
// flag that is consumed at the NEXT successful settle, never launching from the compact event
// itself, because the compacted turn is usually retried right after. Launches are fire-and-forget
// through an injected callback (todo 23 plugs the worker in); this component never sends a visible
// message and never awaits the launch inside a host event handler.

import type { ReflectionEvent, ReflectionRequest, ReservationResult, TriggerConfig } from "@oh-my-opencode/memory-core"
import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"

import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import type { MemoryPendingLedger } from "./context"
import { resolveAgentReflectionSettings } from "./reflection-settings"

/** Resolved trigger policy including the reflection feature switch. */
export type ResolvedTriggerConfig = TriggerConfig & { readonly enabled: boolean }

/** Narrow view of memory-core's ReflectionReservationStore used by the wiring. */
export interface ReflectionTriggerEngine {
  evaluate(conversationId: string, event: ReflectionEvent): Promise<ReservationResult | null>
}

/** Per-session memory state the wiring evaluates against. */
export interface ReflectionTriggerSession {
  readonly conversationId: string
  readonly ledger: MemoryPendingLedger
  readonly engine: ReflectionTriggerEngine
  /** When false, the wiring short-circuits before reserving. Defaults to true when absent. */
  readonly enabled?: boolean
}

export interface ManualReflectionOptions {
  readonly recentN?: number
  readonly conversationIds?: readonly string[]
}

/** Final state of one agent run, recorded at agent_end and consumed at agent_settled. */
export interface AgentRunOutcome {
  readonly aborted: boolean
  readonly willRetry: boolean
  readonly abortSource?: "user" | "system"
}

export interface ReflectionTriggerWiringOptions {
  /** Resolves the bound memory session; undefined means memory is not active for this event. */
  readonly resolveSession: (eventCtx?: unknown) => ReflectionTriggerSession | undefined
  /** Launch action. Todo 23's detached worker plugs in here; the default is a no-op. */
  readonly onLaunch?: (request: ReflectionRequest) => void
  readonly logger?: ComponentLogger
}

export interface ReflectionTriggerWiring {
  register(pi: SenpiExtensionAPI): void
  /** Manual entrypoint for todo 25's /reflect. Fire-and-forget: never blocks the caller. */
  requestManualReflection(focus?: string, options?: ManualReflectionOptions): void
  /** Resolves once every evaluation started so far has finished. */
  whenIdle(): Promise<void>
}

export function createReflectionTriggerWiring(options: ReflectionTriggerWiringOptions): ReflectionTriggerWiring {
  const onLaunch = options.onLaunch ?? (() => {})
  const outcomes = new Map<string, AgentRunOutcome>()
  const inFlight = new Set<Promise<void>>()

  function track(task: () => Promise<void>): void {
    const promise = task()
      .catch((error: unknown) => {
        options.logger?.warn("omo-senpi memory reflection trigger failed", { error: describe(error) })
      })
      .finally(() => {
        inFlight.delete(promise)
      })
    inFlight.add(promise)
  }

  async function evaluateAndLaunch(session: ReflectionTriggerSession, event: ReflectionEvent): Promise<void> {
    const result = await session.engine.evaluate(session.conversationId, event)
    // Only the run that won the active slot launches now; a pending reservation launches when the
    // active run completes (todo 23), which is what keeps repeated settles down to a single run.
    if (result?.status !== "active") return
    launch(result.run.request)
  }

  function launch(request: ReflectionRequest): void {
    try {
      onLaunch(request)
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi memory reflection launch failed", { error: describe(error) })
    }
  }

  return {
    register(pi: SenpiExtensionAPI): void {
      pi.on("agent_end", (payload, eventCtx) => {
        const session = options.resolveSession(eventCtx)
        if (!session) return
        outcomes.set(session.conversationId, readOutcome(payload))
      })

      pi.on("agent_settled", async (_payload, eventCtx) => {
        const session = options.resolveSession(eventCtx)
        if (!session) return
        const outcome = outcomes.get(session.conversationId)
        outcomes.delete(session.conversationId)
        if (outcome === undefined || outcome.aborted || outcome.willRetry) return
        if (session.enabled === false) {
          session.ledger.pendingCompaction = false
          return
        }

        // Not tracked through whenIdle: the host already awaits this handler.
        try {
          if (session.ledger.pendingCompaction) {
            await session.engine.evaluate(session.conversationId, { kind: "compaction_accepted" })
            session.ledger.pendingCompaction = false
          }
          await evaluateAndLaunch(session, { kind: "settled", success: true })
        } catch (error: unknown) {
          options.logger?.warn("omo-senpi memory reflection trigger failed", { error: describe(error) })
        }
      })

      pi.on("session_compact", (payload, eventCtx) => {
        if (!isAcceptedCompaction(payload)) return
        const session = options.resolveSession(eventCtx)
        if (!session) return
        session.ledger.pendingCompaction = true
      })
    },

    requestManualReflection(focus?: string, manual: ManualReflectionOptions = {}): void {
      const session = options.resolveSession()
      if (!session) return
      if (session.enabled === false) return
      track(() =>
        evaluateAndLaunch(session, {
          kind: "manual",
          ...(focus === undefined ? {} : { focus }),
          ...(manual.recentN === undefined ? {} : { recentN: manual.recentN }),
          ...(manual.conversationIds === undefined ? {} : { conversationIds: manual.conversationIds }),
        }),
      )
    },

    async whenIdle(): Promise<void> {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}

/**
 * Resolved reflection trigger policy for the bound agent: per-agent overrides win field by field
 * over the base settings. A step_count of 0 (the default) disables threshold launches entirely.
 * `enabled` false short-circuits trigger evaluation before any reservation is made.
 */
export function resolveReflectionTriggerConfig(settings: OmoMemorySettings, agentName?: string): ResolvedTriggerConfig {
  const reflection = agentName === undefined
    ? settings.reflection
    : resolveAgentReflectionSettings(settings, agentName)
  return {
    enabled: reflection.enabled,
    stepCount: reflection.trigger.step_count,
    onCompaction: reflection.trigger.on_compaction,
  }
}

function readOutcome(payload: unknown): AgentRunOutcome {
  const record = isRecord(payload) ? payload : {}
  const abortSource = record.abortSource
  return {
    aborted: record.aborted === true,
    willRetry: record.willRetry === true,
    ...(abortSource === "user" || abortSource === "system" ? { abortSource } : {}),
  }
}

function isAcceptedCompaction(payload: unknown): boolean {
  return isRecord(payload) && payload.accepted === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
