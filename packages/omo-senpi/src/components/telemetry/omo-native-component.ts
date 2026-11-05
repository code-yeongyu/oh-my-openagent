import type { TurnEndEvent } from "@code-yeongyu/senpi"
import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  createConsentGatedFetch,
  createEventTelemetryClient,
} from "@oh-my-opencode/telemetry-core/injected"
import { createSenpiTelemetryTransportFactory } from "./otlp"
import type {
  EventTelemetryClient,
  TelemetryCaptureMessage,
  TelemetryTransport,
  TelemetryTransportFactory,
  TelemetryTransportOptions,
  TurnTracing,
} from "@oh-my-opencode/telemetry-core"

import type { OmoSenpiComponent } from "../../extension/types"
import { readSessionTraceparent, resolveStateDir } from "@oh-my-opencode/senpi-task"

import { sharedTaskTerminalObservers, type TaskTerminalObservers } from "../task/terminal-observers"
import {
  type ComputerUseTelemetryObservers,
  registerOmoNativeComputerUseTelemetry,
} from "./omo-native-computer-use"
import { createOmoNativeDelegationCapture } from "./omo-native-delegation"
import { registerOmoNativeHandoffHintTelemetry } from "./omo-native-handoff-hint"
import { createOmoNativeNoticeRegistration } from "./omo-native-notice"
import { registerOmoNativeKibitzerSummary } from "./omo-native-kibitzer-summary"
import { registerOmoNativeParallelSummary } from "./omo-native-parallel-summary"
import { createOmoNativePromptComponent } from "./omo-native-prompt"
import {
  createOmoNativeSessionComponent,
  isOmoNativeTelemetryConfigEnabled,
  isOmoNativeTelemetryEnabled,
  type OmoNativeSessionOptions,
} from "./omo-native-session"
import type { SessionSummaryRecorder } from "./omo-native-session-summary"
import { registerOmoNativeToolTelemetry } from "./omo-native-tools"
import { createOmoNativeTurnSpans } from "./omo-native-turn-span"
import { createOmoNativeTurnHandler } from "./omo-native-turns"
import {
  SUMMARY_SHUTDOWN_WAIT_MS,
  createNativeSummaryRecorder,
  settleWithin,
  type NativeCaptureState,
} from "./omo-native-summary-wiring"
import { isTelemetryHostWarmup, resolveTelemetrySessionRole } from "./session-role-resolver"
import type { LoadSummaryRecovery } from "./session-summary-lazy-recovery"
import { removeLegacyRollupsOnce } from "./session-summary-legacy-rollups"
import { startOptOutPurge } from "./session-summary-optout-start"
import { configSelectionOf, withConfigSelection } from "./session-summary-purge"
import type { ConsentScope } from "./session-summary-storage"
import {
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
  OMO_NATIVE_SCHEMA_VERSION,
  createOmoNativeProductConfig,
  getBuiltinSkillsRoot,
  getOmoNativeStateDir,
  hashSessionId,
  withOmoNativeAttribution,
  type OmoNativeEventName,
} from "./product-identity"

type SharedState = NativeCaptureState & {
  /** The live transport's span sink; unset on the PostHog path. */
  traces?: TurnTracing
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
  /** Liveness probe for summary-window owners; injected by tests that simulate dead processes. */
  readonly isPidAlive?: (pid: number) => boolean
  /** Clock for the consent cache. Injected in tests. */
  readonly consentNow?: () => number
  /** Periodic consent check while a summary window is on disk; defaults to an unref'd interval. */
  readonly scheduleConsentCheck?: (check: () => void) => () => void
  /** Loads the recovery sidecar (sweep, send step, opt-out purge); defaults to `#omo-telemetry-recovery-runtime`. */
  readonly loadRecovery?: LoadSummaryRecovery
  /** Receives the opt-out purge started at registration; tests await it. */
  readonly onOptOutPurge?: (purge: Promise<void>) => void
  /** The account home the shared-queue purge reads the persisted setting from; injected by tests. */
  readonly accountHomeDir?: string
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
  const state: SharedState = { delivered: new Set(), acks: new Map() }
  const client: Pick<EventTelemetryClient, "captureEvent"> = {
    captureEvent(name, properties, captureOptions) {
      if (state.isConsented?.() !== true) return
      if (properties.$session_id === OPTED_OUT_SESSION_HASH) return
      if (isOmoNativeEventName(name)) state.capture?.(name, properties, captureOptions)
    },
  }
  return {
    name: "telemetry",
    register(pi, ctx) {
      // The throwaway session that warms a fresh task host is no session of anyone's: it must not be
      // counted as one, nor report the crashes and daily activity the real session reports.
      if (isTelemetryHostWarmup(pi)) return
      // Pre-#10225 rollups have no reader and no sender left: they go for every upgrader, whatever the consent.
      removeLegacyRollupsOnce(stateDir, options.diagnostics)

      // Consent is the session component's own decision (`isOmoNativeTelemetryEnabled`, the single gate),
      // taken at registration and again before every summary write and every session hash: an opted-out
      // registration never creates the summary recorder, so it writes no window, pending or owner file, a
      // mid-session opt-out deletes what it wrote, and deriving a hash alone persists the hashing salt.
      // Every persisted record carries the cwd its consent was read for, and every send or resume re-reads
      // consent for that cwd: a later process in another project cannot send a record its own project opted out of.
      const sessionRole = resolveTelemetrySessionRole(pi, env)
      const consentOptions = { isConfigEnabled: options.isConfigEnabled }
      const consentNow = options.consentNow ?? Date.now
      // Consent is read fresh before every write (one omo.json load, well under a millisecond): a cached
      // read would let a turn right after an opt-out still persist a window.
      const readConsent = (cwd: string | undefined): boolean =>
        isOmoNativeTelemetryEnabled(consentOptions, cwd === undefined ? {} : { cwd }, env)
      // A record is sent, resumed or kept by its writer's config (#11198), with this process's own env opt-outs.
      const isScopeConsented = (scope: ConsentScope): boolean =>
        scope.config === undefined
          ? readConsent(scope.cwd)
          : isOmoNativeTelemetryEnabled(consentOptions, scope.cwd === undefined ? {} : { cwd: scope.cwd }, withConfigSelection(env, scope.config))
      let consentCwd = typeof pi.cwd === "string" && pi.cwd.length > 0 ? pi.cwd : undefined
      const consentedAtRegistration = readConsent(consentCwd)
      // An opted-out process deletes what dead processes left for it at once, not only when it quits.
      // Consent here is the persisted setting only, read with a neutral env: an opt-out set by environment
      // variable (DO_NOT_TRACK, OMO_DISABLE_TELEMETRY, CI, ...) is this process's own and must not delete what
      // consented sessions queued.
      const isQueueScopeConsented = (scope: ConsentScope): boolean =>
        isOmoNativeTelemetryConfigEnabled(consentOptions, scope.cwd === undefined ? {} : { cwd: scope.cwd }, env, options.accountHomeDir, scope.config)
      const purgeQueue = (): Promise<void> => {
        const persistedOptOut = !isQueueScopeConsented(consentCwd === undefined ? { config: configSelectionOf(env) } : { cwd: consentCwd, config: configSelectionOf(env) })
        const load = options.loadRecovery ?? (() => import("#omo-telemetry-recovery-runtime"))
        const queue = startOptOutPurge({
          stateDir,
          isScopeConsented: isQueueScopeConsented,
          persistedOptOut,
          load,
          ...(options.isPidAlive === undefined ? {} : { isPidAlive: options.isPidAlive }),
          ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
        })
        // The shared OTLP spool (beside stateDir) follows the same rule and is skipped while any writer is alive.
        // No spool on disk means nothing to judge: the opted-out start loads no sidecar.
        if (!persistedOptOut || !existsSync(join(stateDir, "..", "otlp"))) return queue
        const spool = load()
          .then(sidecar => sidecar.purgeSenpiOtlpSpoolOnOptOut?.({ env, isPidAlive: options.isPidAlive, diagnostics: options.diagnostics }))
          .catch((error: unknown) => options.diagnostics?.({ event: "telemetry_spool_sweep_failed", source: "otlp", error }))
        return Promise.all([queue, spool]).then(() => undefined)
      }
      const startupPurge = consentedAtRegistration ? undefined : purgeQueue()
      if (startupPurge !== undefined) options.onOptOutPurge?.(startupPurge)
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
      const transportFactory = sharedTransportFactory(
        options.transportFactory ?? createSenpiTelemetryTransportFactory({
          env,
          consent: () => state.isSendAllowed?.() === true,
          diagnostics: options.diagnostics,
          source: "omo-native-component",
        }),
        state,
        options,
      )
      const hashSession = (rawId: string): string =>
        currentConsent(false) ? (options.hashSessionId ?? hashSessionId)(rawId) : OPTED_OUT_SESSION_HASH
      // The span carries the same closed root/child/unknown role as the events: the collector pin refuses any other value.
      // A host whose session context cannot be read must not stop registration (no inherited traceparent then).
      const turnSpans = createOmoNativeTurnSpans({
        traces: () => state.traces,
        isConsented: () => currentConsent(false),
        isSendAllowed: () => currentConsent(true),
        sessionRole,
        inheritedTraceparent: readInheritedTraceparent(pi, env),
      })
      // Every event this session emits goes through here, so one emitted while a turn is open carries that turn's span ids.
      const sessionClient: Pick<EventTelemetryClient, "captureEvent"> = {
        captureEvent: (name, properties) => turnSpans.run(() => client.captureEvent(name, properties)),
      }

      // A turn still open at shutdown must end before the session component's `session_shutdown`
      // handler shuts the transport down, or its span lands on a closed sink. Registered first, so the
      // shutdown-time summaries below are emitted outside any turn. Like every span ending, it is ended
      // (and so exported) only while the fresh send-time consent read allows it; otherwise dropped unended.
      pi.on("session_shutdown", (_payload, eventCtx) => {
        consentCwd = cwdOf(eventCtx) ?? consentCwd
        turnSpans.shutdown()
      })

      // Must precede the session component: its `session_shutdown` handler shuts the client down,
      // which clears `state.capture`, after which `parallelism_summary` would capture nothing.
      registerOmoNativeParallelSummary(pi, {
        captureEvent: sessionClient.captureEvent,
        hashSessionId: hashSession,
      })

      // Same ordering constraint as the parallelism summary: the session component's shutdown
      // handler clears `state.capture`, so this registration must precede it. Its own detach runs
      // after the emission because it is registered second.
      const detachKibitzerSummary = registerOmoNativeKibitzerSummary(pi, {
        captureEvent: sessionClient.captureEvent,
        hashSessionId: hashSession,
      })
      pi.on("session_shutdown", () => {
        detachKibitzerSummary()
      })

      // Same ordering constraint again: the final summary window must be captured before the session
      // component's shutdown handler clears `state.capture`.
      const summary: SessionSummaryRecorder | undefined = consentedAtRegistration
        ? createNativeSummaryRecorder({
          state,
          consent: {
            isConsented: () => currentConsent(true),
            consentScope: () => (consentCwd === undefined ? {} : { cwd: consentCwd, config: configSelectionOf(env) }),
            isScopeConsented,
            scheduleConsentCheck: options.scheduleConsentCheck ?? scheduleUnrefInterval,
          },
          stateDir,
          env,
          cwd: typeof pi.cwd === "string" && pi.cwd.length > 0 ? pi.cwd : undefined,
          sessionRole,
          ...(options.rawTurnSampleRate === undefined ? {} : { rawTurnSampleRate: options.rawTurnSampleRate }),
          ...(options.isPidAlive === undefined ? {} : { isPidAlive: options.isPidAlive }),
          ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
          ...(options.loadRecovery === undefined ? {} : { loadRecovery: options.loadRecovery }),
        })
        : undefined
      // The first capture is when recovery runs: the capture path is installed by then.
      state.onCaptureReady = () => {
        void summary?.recover()
      }
      pi.on("session_shutdown", async (payload, eventCtx) => {
        consentCwd = cwdOf(eventCtx) ?? consentCwd
        if (summary === undefined) {
          await settleWithin(Promise.resolve(startupPurge).then(purgeQueue), SUMMARY_SHUTDOWN_WAIT_MS)
          return
        }
        const reason = isRecord(payload) && typeof payload.reason === "string" ? payload.reason : undefined
        await settleWithin(summary.finish(state.sessionHash ?? hashForContext(eventCtx, hashSession), reason), SUMMARY_SHUTDOWN_WAIT_MS)
        summary.dispose()
      })

      createOmoNativePromptComponent({
        client: sessionClient,
        hashSessionId: hashSession,
      }).register(pi, ctx)

      registerOmoNativeHandoffHintTelemetry(pi, {
        captureEvent: client.captureEvent,
        hashSessionId: hashSession,
      })

      registerOmoNativeComputerUseTelemetry(pi, {
        captureEvent: sessionClient.captureEvent,
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
        captureEvent: sessionClient.captureEvent,
        ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
        hashSessionId: hashSession,
        observers: options.taskTerminalObservers ?? sharedTaskTerminalObservers(),
        stateDir: options.taskStateDir ?? resolveTaskStateDir(pi),
      })
      pi.on("session_shutdown", () => {
        detachDelegation()
      })

      pi.on("turn_start", (payload, eventCtx) => {
        if (!isRecord(payload) || payload.type !== "turn_start" || typeof payload.turnIndex !== "number") return
        consentCwd = cwdOf(eventCtx) ?? consentCwd
        turnSpans.start({
          turnIndex: payload.turnIndex,
          sessionHash: state.sessionHash ?? hashForContext(eventCtx, hashSession),
          rawSessionId: rawSessionIdOf(eventCtx),
          model: contextModelOf(eventCtx),
        })
      })
      pi.on("turn_end", async (payload, eventCtx) => {
        if (!isTurnEndEvent(payload)) return
        consentCwd = cwdOf(eventCtx) ?? consentCwd
        // An opted-out registration has no summary and records no turn; the span step below runs either way
        // and is a no-op when no span was started.
        if (summary !== undefined) {
          // The first turn waits for the summary sidecar, so its window is on disk when the turn ends.
          await summary.prepare?.()
          const sessionHash = state.sessionHash ?? hashForContext(eventCtx, hashSession)
          turnSpans.run(() => createOmoNativeTurnHandler({
            client: sessionClient,
            diagnostics: options.diagnostics,
            isConsented: () => currentConsent(false),
            sessionId: sessionHash,
            sessionRole,
            summary,
          })(payload))
        }
        const message = payload.message as Readonly<Record<string, unknown>>
        turnSpans.end({
          response: typeof message["provider"] === "string" && typeof message["model"] === "string"
            ? { provider: message["provider"], modelId: message["model"] }
            : undefined,
          responseModelId: typeof message["responseModel"] === "string" ? message["responseModel"] : undefined,
          failed: message["stopReason"] === "error",
        })
      })
      pi.on("agent_end", () => {
        turnSpans.abandon()
      })

      registerOmoNativeToolTelemetry(pi, {
        captureEvent: sessionClient.captureEvent,
        diagnostics: (message, details) => ctx.logger.warn(message, details),
        hashSessionId: hashSession,
        skillsRoot: options.skillsRoot ?? getBuiltinSkillsRoot(env, ctx.logger),
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
    state.traces = transport.traces

    const wrapped: TelemetryTransport = {
      capture(message) {
        const firstCapture = state.capture === undefined
        installCaptureFacade(state, transport, message, options)
        forwardValidatedCapture(transport, message)?.catch((error: unknown) => reportCaptureFailure(options, error))
        if (firstCapture) state.onCaptureReady?.()
      },
      flush: transport.flush === undefined ? undefined : () => transport.flush?.() ?? Promise.resolve(),
      ...(transport.traces === undefined ? {} : { traces: transport.traces }),
      async shutdown() {
        try {
          // A drop still held here keeps the gate closed, so the shutdown drain discards what is queued.
          await transport.shutdown()
        } finally {
          clearTimeout(dropRetry)
          dropRetry = undefined
          state.dropQueued = undefined
          if (state.traces === transport.traces) state.traces = undefined
          if (state.capture !== undefined) {
            state.capture = undefined
            state.flush = undefined
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
    product: withOmoNativeAttribution(createOmoNativeProductConfig(), { env: options.env }),
    propertyAllowlist: OMO_NATIVE_PROPERTY_ALLOWLISTS,
    schemaVersion: OMO_NATIVE_SCHEMA_VERSION,
    source: "omo-native-component",
    onCapture(payload) {
      if (typeof payload.uuid === "string") state.delivered.add(payload.uuid)
    },
    transportFactory: () => ({
      capture(message) {
        const ack = forwardValidatedCapture(transport, message)
        if (ack === undefined || message.uuid === undefined) return
        // The publisher awaits this promise; a send it never reaches must not surface as an unhandled rejection.
        void ack.catch(() => undefined)
        state.acks.set(message.uuid, ack)
      },
      shutdown: async () => undefined,
    }),
  })
  state.capture = privacyClient.captureEvent
  state.flush = () => transport.flush?.() ?? Promise.resolve()
}

// This is the sole native transport boundary. Every message reaching it has already passed through
// telemetry-core's captureEvent privacy wrapper; keeping the raw transport call here makes the
// source-scanning invariant precise and prevents native event producers from bypassing validation.
// An ack-gated event (session_summary, carrying its uuid) is sent immediately and its promise returned, so
// its pending file is retired only once the server accepted it; everything else is batched.
function forwardValidatedCapture(transport: TelemetryTransport, message: TelemetryCaptureMessage): Promise<void> | undefined {
  if (message.event === "session_summary" && message.uuid !== undefined && transport.captureImmediate !== undefined) {
    return transport.captureImmediate(message)
  }
  transport.capture(message)
  return undefined
}

function reportCaptureFailure(options: OmoNativeTelemetryComponentOptions, error: unknown): void {
  options.diagnostics?.({
    event: "telemetry_capture_failed",
    source: "omo-native-component",
    error,
    errorKind: error instanceof Error ? "error" : "non_error",
  })
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

function readInheritedTraceparent(pi: unknown, env: NodeJS.ProcessEnv): string | undefined {
  try {
    return readSessionTraceparent(pi, env)
  } catch {
    return undefined
  }
}

function rawSessionIdOf(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx.sessionManager)) return undefined
  const getter = eventCtx.sessionManager.getSessionId
  if (typeof getter !== "function") return undefined
  const sessionId: unknown = getter.call(eventCtx.sessionManager)
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}

function contextModelOf(eventCtx: unknown): { readonly provider: string; readonly modelId: string } | undefined {
  const model = isRecord(eventCtx) ? eventCtx.model : undefined
  if (!isRecord(model) || typeof model.provider !== "string" || typeof model.id !== "string") return undefined
  return { provider: model.provider, modelId: model.id }
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
