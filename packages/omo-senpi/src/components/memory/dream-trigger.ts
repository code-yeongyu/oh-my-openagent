// Dream trigger wiring (plan todo 12): opportunistic dream launches from idle, shutdown,
// pressure, and manual origins. Transcript-driven automatic origins (idle, shutdown) pass three
// gates - dream.enabled, min_hours_between, and the unreflected-volume floor. Pressure shares the
// first two gates but bypasses transcript volume, while manual bypasses all three; todo 14 owns the manual
// call site, this module ships the bypass path. The idle detector is an in-extension timer armed
// on agent_settled, reset by input/agent_start/session_compact, and cancelled by
// session_shutdown/session_abort; it fires only while the host still reports idle with no pending
// messages. No native session_idle listener is registered: ExtensionAPI has no such overload
// today, and todo 21 retires this timer only once a native event reports
// idleMs >= dream.idle_minutes * 60_000. A fire requests a dream launch through the todo 13
// reservation machine; only the run that wins the active slot launches now.

import type {
  MemoryIdentityPaths,
  ReservedRun,
  ReflectionReservationStore,
  TranscriptJournal,
} from "@oh-my-opencode/memory-core"

import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import { fireDream } from "./dream-trigger-fire"
import type { DreamGateRejection, DreamTriggerSettings } from "./dream-trigger-gates"
import type { ShutdownEvaluator } from "./shutdown-drain"

export * from "./dream-trigger-gates"

/** Per-session dream state the wiring evaluates against. */
export interface DreamTriggerSession {
  readonly conversationId: string
  readonly identity: string
  readonly identityPaths: MemoryIdentityPaths
  readonly getJournal: (conversationId: string) => Promise<Pick<TranscriptJournal, "captureReflectionSnapshot">>
  readonly store: Pick<ReflectionReservationStore, "tryReserve">
  readonly launch: (run: ReservedRun) => void
}

/** Timer seam; tests inject a deterministic scheduler. */
export interface DreamTriggerScheduler {
  schedule(fire: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

const defaultScheduler: DreamTriggerScheduler = {
  schedule: (fire, delayMs) => {
    const timer = setTimeout(fire, delayMs)
    // An idle-detection timer must never keep the host process alive.
    timer.unref()
    return timer
  },
  cancel: (handle) => {
    clearTimeout(handle as Parameters<typeof clearTimeout>[0])
  },
}

export type DreamFireRejection = DreamGateRejection | "no_unreflected_content" | "no_session" | "aborted"

export type DreamFireOutcome =
  | { readonly fired: true; readonly runId: string; readonly status: "active" | "pending" }
  | { readonly fired: false; readonly rejection: DreamFireRejection }

export interface ManualDreamRequest {
  readonly focus?: string
  readonly conversationIds?: readonly string[]
  readonly targetDoc?: string
}

export interface DreamTriggerWiringOptions {
  /** Resolves the bound session for a host event; undefined means memory is not active there. */
  readonly resolveSession: (eventCtx?: unknown) => DreamTriggerSession | undefined
  /** Resolves the foreground session for the manual path (todo 14's /dream call site). */
  readonly resolveActiveSession: () => DreamTriggerSession | undefined
  /** Resolves a session by id for the shutdown evaluator, which has no event context. */
  readonly resolveSessionById: (sessionId: string) => DreamTriggerSession | undefined
  readonly resolveSettings: (identity: string) => DreamTriggerSettings
  readonly now?: () => number
  readonly scheduler?: DreamTriggerScheduler
  readonly logger?: ComponentLogger
}

export interface DreamTriggerWiring {
  register(pi: SenpiExtensionAPI): void
  /** IC-10 evaluator for todo 10's drain; the drain runs it only on quit, after the fixed steps. */
  shutdownEvaluator(): ShutdownEvaluator
  /** Manual entrypoint for todo 14's /dream. Bypasses every automatic gate. */
  requestManualDream(request?: ManualDreamRequest): Promise<DreamFireOutcome>
  /** Status-refresh entrypoint for system-token pressure; bypasses idle and transcript-volume gates. */
  requestPressureDream(sessionId: string): Promise<DreamFireOutcome>
  /** Resolves once every fire started so far has finished. */
  whenIdle(): Promise<void>
}

export function createDreamTriggerWiring(options: DreamTriggerWiringOptions): DreamTriggerWiring {
  const now = options.now ?? Date.now
  const scheduler = options.scheduler ?? defaultScheduler
  const timers = new Map<string, { readonly handle: unknown; readonly eventCtx: unknown }>()
  const inFlight = new Set<Promise<void>>()
  const launch = (session: DreamTriggerSession, origin: "idle" | "shutdown" | "manual" | "pressure", request: ManualDreamRequest & {
    readonly signal?: AbortSignal
    readonly deadlineAt?: number
  }) =>
    fireDream({
      session,
      origin,
      settings: options.resolveSettings(session.identity),
      request,
      now,
      warnLaunchFailure: (error) => options.logger?.warn("omo-senpi memory dream launch failed", { error: describe(error) }),
    })

  function track(task: () => Promise<void>): void {
    const promise = task()
      .catch((error: unknown) => {
        options.logger?.warn("omo-senpi memory dream trigger failed", { error: describe(error) })
      })
      .finally(() => {
        inFlight.delete(promise)
      })
    inFlight.add(promise)
  }

  function cancelTimer(conversationId: string): void {
    const state = timers.get(conversationId)
    if (state === undefined) return
    timers.delete(conversationId)
    scheduler.cancel(state.handle)
  }

  function arm(session: DreamTriggerSession, eventCtx: unknown): void {
    cancelTimer(session.conversationId)
    const settings = options.resolveSettings(session.identity)
    if (settings.idleMinutes <= 0) return
    const handle = scheduler.schedule(() => fire(session.conversationId), settings.idleMinutes * 60_000)
    timers.set(session.conversationId, { handle, eventCtx })
  }

  function resetFor(eventCtx: unknown): void {
    const session = options.resolveSession(eventCtx)
    if (session === undefined) return
    cancelTimer(session.conversationId)
  }

  function fire(conversationId: string): void {
    const state = timers.get(conversationId)
    if (state === undefined) return
    timers.delete(conversationId)
    if (!isIdleNow(state.eventCtx)) return
    const session = options.resolveSession(state.eventCtx)
    if (session === undefined || session.conversationId !== conversationId) return
    track(async () => {
      await launch(session, "idle", {})
    })
  }

  return {
    register(pi: SenpiExtensionAPI): void {
      pi.on("agent_settled", (_payload, eventCtx) => {
        const session = options.resolveSession(eventCtx)
        if (session === undefined) return
        arm(session, eventCtx)
      })
      pi.on("input", (_payload, eventCtx) => resetFor(eventCtx))
      pi.on("agent_start", (_payload, eventCtx) => resetFor(eventCtx))
      pi.on("session_compact", (_payload, eventCtx) => resetFor(eventCtx))
      pi.on("session_shutdown", (_payload, eventCtx) => resetFor(eventCtx))
      pi.on("session_abort", (_payload, eventCtx) => resetFor(eventCtx))
    },

    shutdownEvaluator(): ShutdownEvaluator {
      return async (input) => {
        if (input.signal.aborted) return
        const session = options.resolveSessionById(input.sessionId)
        if (session === undefined) return
        await launch(session, "shutdown", { signal: input.signal, deadlineAt: input.deadlineAt })
      }
    },

    async requestManualDream(request: ManualDreamRequest = {}): Promise<DreamFireOutcome> {
      const session = options.resolveActiveSession()
      if (session === undefined) return { fired: false, rejection: "no_session" }
      return launch(session, "manual", request)
    },

    async requestPressureDream(sessionId: string): Promise<DreamFireOutcome> {
      const session = options.resolveSessionById(sessionId)
      if (session === undefined) return { fired: false, rejection: "no_session" }
      return launch(session, "pressure", {})
    },

    async whenIdle(): Promise<void> {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}

/** Fail-closed idle probe: a context without both probes can never report idle. */
function isIdleNow(eventCtx: unknown): boolean {
  if (!isRecord(eventCtx)) return false
  const isIdle = eventCtx.isIdle
  const hasPending = eventCtx.hasPendingMessages
  if (typeof isIdle !== "function" || typeof hasPending !== "function") return false
  return Reflect.apply(isIdle, eventCtx, []) === true && Reflect.apply(hasPending, eventCtx, []) === false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
