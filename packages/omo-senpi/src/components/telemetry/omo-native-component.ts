import type { TurnEndEvent } from "@code-yeongyu/senpi"
import {
  createDefaultPostHogTransport,
  createEventTelemetryClient,
} from "@oh-my-opencode/telemetry-core"
import type {
  EventTelemetryClient,
  EventTelemetryProperties,
  TelemetryCaptureMessage,
  TelemetryTransport,
  TelemetryTransportFactory,
  TelemetryTransportOptions,
} from "@oh-my-opencode/telemetry-core"

import type { OmoSenpiComponent } from "../../extension/types"
import { resolveStateDir } from "@oh-my-opencode/senpi-task"

import { sharedTaskTerminalObservers, type TaskTerminalObservers } from "../task/terminal-observers"
import { createOmoNativeDelegationCapture } from "./omo-native-delegation"
import { createOmoNativeNoticeRegistration } from "./omo-native-notice"
import { registerOmoNativeParallelSummary } from "./omo-native-parallel-summary"
import { createOmoNativePromptComponent } from "./omo-native-prompt"
import {
  createOmoNativeSessionComponent,
  type OmoNativeSessionOptions,
} from "./omo-native-session"
import { registerOmoNativeToolTelemetry } from "./omo-native-tools"
import { createOmoNativeTurnHandler } from "./omo-native-turns"
import {
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
  OMO_NATIVE_SCHEMA_VERSION,
  createOmoNativeProductConfig,
  getOmoNativeStateDir,
  hashSessionId,
  type OmoNativeEventName,
} from "./product-identity"

type SharedState = {
  capture?: (name: OmoNativeEventName, properties: EventTelemetryProperties) => void
  sessionHash?: string
}

export type OmoNativeTelemetryComponentOptions = OmoNativeSessionOptions & {
  readonly stateDir?: string
  readonly skillsRoot?: string
  /** Terminal-edge ledger the task engine notifies. Injected in tests; defaults to the shared one. */
  readonly taskTerminalObservers?: TaskTerminalObservers
  /** Where senpi-task keeps its records and per-task event logs. Defaults to the session's project. */
  readonly taskStateDir?: string
}

export function createOmoNativeTelemetryComponent(options: OmoNativeTelemetryComponentOptions = {}): OmoSenpiComponent {
  const env = options.env ?? process.env
  const stateDir = options.stateDir ?? getOmoNativeStateDir(env)
  const state: SharedState = {}
  const client: Pick<EventTelemetryClient, "captureEvent"> = {
    captureEvent(name, properties) {
      if (isOmoNativeEventName(name)) state.capture?.(name, properties)
    },
  }
  const transportFactory = sharedTransportFactory(
    options.transportFactory ?? createDefaultPostHogTransport,
    state,
    options,
  )

  return {
    name: "telemetry",
    register(pi, ctx) {
      // Must precede the session component: its `session_shutdown` handler shuts the client down,
      // which clears `state.capture`, after which `parallelism_summary` would capture nothing.
      registerOmoNativeParallelSummary(pi, {
        captureEvent: client.captureEvent,
        hashSessionId: options.hashSessionId ?? hashSessionId,
      })

      createOmoNativePromptComponent({
        client,
        hashSessionId: options.hashSessionId,
      }).register(pi, ctx)

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
        hashSessionId: options.hashSessionId ?? hashSessionId,
        observers: options.taskTerminalObservers ?? sharedTaskTerminalObservers(),
        stateDir: options.taskStateDir ?? resolveTaskStateDir(pi),
      })
      pi.on("session_shutdown", () => {
        detachDelegation()
      })

      pi.on("turn_end", (payload, eventCtx) => {
        if (!isTurnEndEvent(payload)) return
        const sessionHash = state.sessionHash ?? hashForContext(eventCtx, options.hashSessionId)
        createOmoNativeTurnHandler({
          client,
          diagnostics: options.diagnostics,
          sessionId: sessionHash,
        })(payload)
      })

      registerOmoNativeToolTelemetry(pi, {
        captureEvent: client.captureEvent,
        diagnostics: (message, details) => ctx.logger.warn(message, details),
        hashSessionId: options.hashSessionId,
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
    const transport = factory(apiKey, transportOptions)
    if (!isNativeTransport(transportOptions)) return transport

    const wrapped: TelemetryTransport = {
      capture(message) {
        installCaptureFacade(state, transport, message, options)
        forwardValidatedCapture(transport, message)
      },
      flush: transport.flush === undefined ? undefined : () => transport.flush?.() ?? Promise.resolve(),
      async shutdown() {
        try {
          await transport.shutdown()
        } finally {
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
    product: createOmoNativeProductConfig(),
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

function hashForContext(
  value: unknown,
  hash: ((rawId: string) => string) | undefined,
): string {
  if (isRecord(value) && isRecord(value.sessionManager)) {
    const getter = value.sessionManager.getSessionId
    if (typeof getter === "function") {
      const sessionId: unknown = getter.call(value.sessionManager)
      if (typeof sessionId === "string" && sessionId.length > 0) return (hash ?? hashSessionId)(sessionId)
    }
  }
  return (hash ?? hashSessionId)("unknown")
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
