import type { TurnEndEvent } from "@code-yeongyu/senpi"
import {
  createConsentGatedFetch,
  createEventTelemetryClient,
} from "@oh-my-opencode/telemetry-core/injected"
import { createLazyPostHogTransportFactory } from "./lazy-posthog"
import type {
  EventTelemetryClient,
  EventTelemetryProperties,
  TelemetryCaptureMessage,
  TelemetryTransport,
  TelemetryTransportFactory,
  TelemetryTransportOptions,
} from "@oh-my-opencode/telemetry-core"

import type { OmoSenpiComponent } from "../../extension/types"
import { isHostWarmupSession, readSessionRole, resolveStateDir } from "@oh-my-opencode/senpi-task"

import { sharedTaskTerminalObservers, type TaskTerminalObservers } from "../task/terminal-observers"
import {
  type ComputerUseTelemetryObservers,
  registerOmoNativeComputerUseTelemetry,
} from "./omo-native-computer-use"
import { createOmoNativeDelegationCapture } from "./omo-native-delegation"
import { createOmoNativeNoticeRegistration } from "./omo-native-notice"
import { registerOmoNativeKibitzerSummary } from "./omo-native-kibitzer-summary"
import { registerOmoNativeParallelSummary } from "./omo-native-parallel-summary"
import { createOmoNativePromptComponent } from "./omo-native-prompt"
import {
  createOmoNativeSessionComponent,
  isOmoNativeTelemetryEnabled,
  type OmoNativeSessionOptions,
} from "./omo-native-session"
import { registerOmoNativeToolTelemetry } from "./omo-native-tools"
import { createOmoNativeTurnHandler } from "./omo-native-turns"
import { createSessionSummaryRecorder } from "./omo-native-session-summary"
import { createSummaryStore } from "./session-summary-store"
import {
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
  OMO_NATIVE_SCHEMA_VERSION,
  createOmoNativeProductConfig,
  getOmoNativeStateDir,
  hashSessionId,
  withOmoNativeAttribution,
  type OmoNativeEventName,
} from "./product-identity"

type SharedState = {
  capture?: (name: OmoNativeEventName, properties: EventTelemetryProperties) => void
  sessionHash?: string
  /** The one consent gate as of now; unset until registration, so nothing leaves the fan-in before it. */
  isConsented?: () => boolean
  /** The same gate read fresh, at the moment a queued batch would leave the process. */
  isSendAllowed?: () => boolean
  /** Empties the native SDK queue without sending it; set while a native transport is live. */
  dropQueued?: () => void
}

export type OmoNativeTelemetryComponentOptions = OmoNativeSessionOptions & {
  readonly stateDir?: string
  readonly skillsRoot?: string
  /** Terminal-edge ledger the task engine notifies. Injected in tests; defaults to the shared one. */
  readonly taskTerminalObservers?: TaskTerminalObservers
  /** Where senpi-task keeps its records and per-task event logs. Defaults to the session's project. */
  readonly taskStateDir?: string
  readonly computerUseTelemetryObservers?: ComputerUseTelemetryObservers
  /** Share of sessions that also send every raw `turn_completed`; tests pin it to 0 or 1. */
  readonly rawTurnSampleRate?: number
  /** Clock for the consent cache. Injected in tests. */
  readonly consentNow?: () => number
  /** Periodic consent check while a summary window is on disk; defaults to an unref'd interval. */
  readonly scheduleConsentCheck?: (check: () => void) => () => void
}

/** A consent read is reused for this long on the per-turn path; the periodic check always reads fresh. */
export const CONSENT_CACHE_MS = 5_000
/** How often a persisted window re-checks consent, so an opt-out deletes it even if no turn follows. */
export const CONSENT_CHECK_INTERVAL_MS = 5_000
/** How long a failed drop flush waits before draining the still-queued events again; the gate stays closed meanwhile. */
const DROP_RETRY_MS = 5_000
/** What a session hashes to while consent is off: no salt is read or created, and no event carrying it is sent. */
const OPTED_OUT_SESSION_HASH = "opted-out"

export function createOmoNativeTelemetryComponent(options: OmoNativeTelemetryComponentOptions = {}): OmoSenpiComponent {
  const env = options.env ?? process.env
  const stateDir = options.stateDir ?? getOmoNativeStateDir(env)
  const state: SharedState = {}
  const client: Pick<EventTelemetryClient, "captureEvent"> = {
    captureEvent(name, properties) {
      if (state.isConsented?.() !== true) return
      if (properties.$session_id === OPTED_OUT_SESSION_HASH) return
      if (isOmoNativeEventName(name)) state.capture?.(name, properties)
    },
  }
  const transportFactory = sharedTransportFactory(
    options.transportFactory ?? createLazyPostHogTransportFactory({
      diagnostics: options.diagnostics,
      source: "omo-native-component",
    }),
    state,
    options,
  )

  return {
    name: "telemetry",
    register(pi, ctx) {
      // The throwaway session that warms a fresh task host is no session of anyone's: it must not be
      // counted as one, nor report the crashes and daily activity the real session reports.
      if (isHostWarmupSession(pi)) return

      // Consent is the session component's own decision (`isOmoNativeTelemetryEnabled`, the single gate),
      // taken at registration and again before every summary write and every session hash: an opted-out
      // session must leave nothing on disk that a later process could send, and deriving a hash alone
      // persists the hashing salt.
      // Every persisted window carries the cwd its consent was read for, and recovery re-reads consent
      // for that cwd: a later process in another project cannot send a window its own project opted out of.
      const consentOptions = { isConfigEnabled: options.isConfigEnabled }
      const consentNow = options.consentNow ?? Date.now
      const readConsent = (cwd: string | undefined): boolean =>
        isOmoNativeTelemetryEnabled(consentOptions, cwd === undefined ? {} : { cwd }, env)
      let consentCwd = typeof pi.cwd === "string" && pi.cwd.length > 0 ? pi.cwd : undefined
      const consentedAtRegistration = readConsent(consentCwd)
      let cached = { cwd: consentCwd, at: consentNow(), value: consentedAtRegistration }
      const currentConsent = (fresh: boolean): boolean => {
        const at = consentNow()
        if (!fresh && cached.cwd === consentCwd && at - cached.at < CONSENT_CACHE_MS) return cached.value
        const wasConsented = cached.value
        cached = { cwd: consentCwd, at, value: readConsent(consentCwd) }
        // Events queued before the withdrawal are dropped the moment it is read, not sent by a later flush.
        if (wasConsented && !cached.value) state.dropQueued?.()
        return cached.value
      }
      // Read before EVERY event leaves the fan-in, not only when a session is hashed or sampled: a
      // session sampled while opted in keeps its real hash after a withdrawal, so the sentinel cannot
      // stop its later events.
      state.isConsented = () => currentConsent(false)
      state.isSendAllowed = () => currentConsent(true)
      const hashSession = (rawId: string): string =>
        currentConsent(false) ? (options.hashSessionId ?? hashSessionId)(rawId) : OPTED_OUT_SESSION_HASH

      // Must precede the session component: its `session_shutdown` handler shuts the client down,
      // which clears `state.capture`, after which `parallelism_summary` would capture nothing.
      registerOmoNativeParallelSummary(pi, {
        captureEvent: client.captureEvent,
        hashSessionId: hashSession,
      })

      // Same ordering constraint as the parallelism summary: the session component's shutdown
      // handler clears `state.capture`, so this registration must precede it. Its own detach runs
      // after the emission because it is registered second.
      const detachKibitzerSummary = registerOmoNativeKibitzerSummary(pi, {
        captureEvent: client.captureEvent,
        hashSessionId: hashSession,
      })
      pi.on("session_shutdown", () => {
        detachKibitzerSummary()
      })

      // Same ordering constraint again: the final summary window must be captured before the session
      // component's shutdown handler clears `state.capture`.
      const summary = createSessionSummaryRecorder({
        captureEvent: client.captureEvent,
        store: createSummaryStore({ stateDir }),
        sessionRole: readSessionRole(pi, env) ?? "main",
        isConsented: (check) => consentedAtRegistration && currentConsent(check?.fresh === true),
        consentScope: () => (consentCwd === undefined ? {} : { cwd: consentCwd }),
        isScopeConsented: (scope) => readConsent(scope.cwd),
        scheduleConsentCheck: options.scheduleConsentCheck ?? scheduleUnrefInterval,
        ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
        ...(options.rawTurnSampleRate === undefined ? {} : { sampleRate: options.rawTurnSampleRate }),
      })
      pi.on("session_shutdown", (payload, eventCtx) => {
        const reason = isRecord(payload) && typeof payload.reason === "string" ? payload.reason : undefined
        consentCwd = cwdOf(eventCtx)
        summary.finish(state.sessionHash ?? hashForContext(eventCtx, hashSession), reason)
        summary.dispose()
      })

      createOmoNativePromptComponent({
        client,
        hashSessionId: hashSession,
      }).register(pi, ctx)

      registerOmoNativeComputerUseTelemetry(pi, {
        captureEvent: client.captureEvent,
        hashSessionId: hashSession,
        ...(options.computerUseTelemetryObservers === undefined
          ? {}
          : { observers: options.computerUseTelemetryObservers }),
      })

      createOmoNativeSessionComponent({
        ...options,
        env,
        transportFactory,
      }).register(pi, ctx)

      // Task terminals are observed for the whole process lifetime of this registration, not per
      // session event: a background child can settle long after the turn that spawned it. The
      // subscription is detached on session shutdown so a re-register cannot pile observers up.
      const detachDelegation = createOmoNativeDelegationCapture({
        captureEvent: client.captureEvent,
        ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
        hashSessionId: hashSession,
        observers: options.taskTerminalObservers ?? sharedTaskTerminalObservers(),
        stateDir: options.taskStateDir ?? resolveTaskStateDir(pi),
      })
      pi.on("session_shutdown", () => {
        detachDelegation()
      })

      pi.on("turn_end", (payload, eventCtx) => {
        if (!isTurnEndEvent(payload)) return
        consentCwd = cwdOf(eventCtx)
        const sessionHash = state.sessionHash ?? hashForContext(eventCtx, hashSession)
        createOmoNativeTurnHandler({
          client,
          diagnostics: options.diagnostics,
          isConsented: () => currentConsent(false),
          sessionId: sessionHash,
          summary,
        })(payload)
      })

      registerOmoNativeToolTelemetry(pi, {
        captureEvent: client.captureEvent,
        diagnostics: (message, details) => ctx.logger.warn(message, details),
        hashSessionId: hashSession,
        skillsRoot: options.skillsRoot,
      })

      createOmoNativeNoticeRegistration({
        diagnostics: options.diagnostics,
        env,
        isConfigEnabled: options.isConfigEnabled,
        stateDir,
      }).register(pi, ctx)
    },
  }
}

function sharedTransportFactory(
  factory: TelemetryTransportFactory,
  state: SharedState,
  options: OmoNativeTelemetryComponentOptions,
): TelemetryTransportFactory {
  return (apiKey, transportOptions) => {
    if (!isNativeTransport(transportOptions)) return factory(apiKey, transportOptions)

    // The SDK sends its interval, batch-size and shutdown flushes through this one fetch, so the gate
    // read here stops an event that was queued while consented and is still unsent at withdrawal.
    let dropping = 0
    let dropRetry: ReturnType<typeof setTimeout> | undefined
    const transport = factory(apiKey, {
      ...transportOptions,
      fetch: createConsentGatedFetch({
        isSendAllowed: () => dropping === 0 && state.isSendAllowed?.() === true,
        onDropped: (count) => options.diagnostics?.({
          event: "telemetry_events_dropped_by_consent",
          source: "omo-native-component",
          count,
        }),
        ...(transportOptions.fetch === undefined ? {} : { fetch: transportOptions.fetch }),
      }),
    })
    // Holds the gate closed until one drain of the queue has finished. A drop flush that fails keeps
    // its hold and drains again later: whatever it left queued was captured before the withdrawal, so no
    // later flush may send it, even after consent comes back.
    const drainUnsent = (): void => {
      if (transport.flush === undefined) return
      dropping += 1
      transport.flush().then(
        () => {
          dropping -= 1
        },
        (error: unknown) => {
          options.diagnostics?.({
            event: "telemetry_drop_flush_failed",
            source: "omo-native-component",
            error,
            errorKind: error instanceof Error ? "error" : "non_error",
          })
          dropRetry = setTimeout(() => {
            dropRetry = undefined
            dropping -= 1
            drainUnsent()
          }, DROP_RETRY_MS)
          dropRetry.unref?.()
        },
      )
    }
    state.dropQueued = drainUnsent

    const wrapped: TelemetryTransport = {
      capture(message) {
        installCaptureFacade(state, transport, message, options)
        forwardValidatedCapture(transport, message)
      },
      flush: transport.flush === undefined ? undefined : () => transport.flush?.() ?? Promise.resolve(),
      async shutdown() {
        try {
          // A drop still held here keeps the gate closed, so the shutdown drain discards what is queued.
          await transport.shutdown()
        } finally {
          clearTimeout(dropRetry)
          dropRetry = undefined
          state.dropQueued = undefined
          if (state.capture !== undefined) {
            state.capture = undefined
            state.sessionHash = undefined
          }
        }
      },
    }
    return wrapped
  }
}

function installCaptureFacade(
  state: SharedState,
  transport: TelemetryTransport,
  template: TelemetryCaptureMessage,
  options: OmoNativeTelemetryComponentOptions,
): void {
  // ONLY the session-start event may teach this process which session it is in. A resumed task row
  // carries the hash of the session that OWNS it, and letting that hash win here would redirect every
  // later main-session event to a session the user is no longer in.
  const sessionId = template.event === "daily_active" || template.event === "session_started"
    ? template.properties?.$session_id
    : undefined
  state.sessionHash = typeof sessionId === "string" ? sessionId : state.sessionHash
  const privacyClient = createEventTelemetryClient({
    diagnostics: options.diagnostics,
    distinctId: template.distinctId,
    env: options.env,
    product: withOmoNativeAttribution(createOmoNativeProductConfig(), {
      env: options.env,
      now: options.now,
      osProvider: options.osProvider,
    }),
    propertyAllowlist: OMO_NATIVE_PROPERTY_ALLOWLISTS,
    schemaVersion: OMO_NATIVE_SCHEMA_VERSION,
    source: "omo-native-component",
    transportFactory: () => ({
      capture(message) {
        forwardValidatedCapture(transport, message)
      },
      shutdown: async () => undefined,
    }),
  })
  state.capture = privacyClient.captureEvent
}

// This is the sole native transport boundary. Every message reaching it has already passed through
// telemetry-core's captureEvent privacy wrapper; keeping the raw transport call here makes the
// source-scanning invariant precise and prevents native event producers from bypassing validation.
function forwardValidatedCapture(transport: TelemetryTransport, message: TelemetryCaptureMessage): void {
  transport.capture(message)
}

// The task engine anchors its state dir to the session's project directory; the follow-up counters
// read the per-task event log under it. A cwd-less host falls back to the process cwd exactly as the
// task component does, and a missing log simply yields zero counters.
function resolveTaskStateDir(pi: { readonly cwd?: string }): string {
  return resolveStateDir({ project_dir: typeof pi.cwd === "string" && pi.cwd.length > 0 ? pi.cwd : process.cwd() })
}

function scheduleUnrefInterval(check: () => void): () => void {
  const timer = setInterval(check, CONSENT_CHECK_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

function cwdOf(eventCtx: unknown): string | undefined {
  const cwd = isRecord(eventCtx) ? eventCtx.cwd : undefined
  return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined
}

function hashForContext(value: unknown, hash: (rawId: string) => string): string {
  if (isRecord(value) && isRecord(value.sessionManager)) {
    const getter = value.sessionManager.getSessionId
    if (typeof getter === "function") {
      const sessionId: unknown = getter.call(value.sessionManager)
      if (typeof sessionId === "string" && sessionId.length > 0) return hash(sessionId)
    }
  }
  return hash("unknown")
}

function isNativeTransport(options: TelemetryTransportOptions): boolean {
  return options.flushAt === 20 && options.flushInterval === 10_000
}

function isOmoNativeEventName(name: string): name is OmoNativeEventName {
  return Object.hasOwn(OMO_NATIVE_PROPERTY_ALLOWLISTS, name)
}

function isTurnEndEvent(value: unknown): value is TurnEndEvent {
  return isRecord(value) && value.type === "turn_end" && typeof value.turnIndex === "number" && isRecord(value.message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
