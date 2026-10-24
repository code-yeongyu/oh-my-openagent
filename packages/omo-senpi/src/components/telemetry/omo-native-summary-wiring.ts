import type {
  EventTelemetryCaptureOptions,
  EventTelemetryProperties,
  TelemetryDiagnosticInput,
  TelemetryEnv,
} from "@oh-my-opencode/telemetry-core"

import { loadSenpiOmoConfig } from "../config-resolution"
import type { SessionSummaryOptions, SessionSummaryRecorder } from "./omo-native-session-summary"
import type { OmoNativeEventName } from "./product-identity"
import type { TelemetrySessionRole } from "./session-role"
import { isSessionSampled, resolveRawTurnSampleRate } from "./session-summary-sampling"

/** The part of the telemetry sidecar the entry bundle loads lazily: the recorder and its storage. */
export type SummaryRuntime = Pick<
  typeof import("./session-summary-recovery"),
  "createSessionSummaryRecorder" | "createSummaryStorage" | "currentProcessOwner"
>
export type LoadSummaryRuntime = () => Promise<SummaryRuntime>
export const loadSummaryRuntime: LoadSummaryRuntime = () => import("#omo-telemetry-recovery-runtime")


/** What the component's transport facade shares with every registration of one loaded extension. */
export type NativeCaptureState = {
  capture?: (name: OmoNativeEventName, properties: EventTelemetryProperties, options?: EventTelemetryCaptureOptions) => void
  flush?: () => Promise<void>
  sessionHash?: string
  /** Event uuids the privacy client actually handed to the transport (rejected events never get here). */
  readonly delivered: Set<string>
  /** Per-uuid promise of an immediate send: it resolves on a 2xx answer for that very event, else rejects. */
  readonly acks: Map<string, Promise<void>>
  onCaptureReady?: () => void
  /** The one consent gate as of now; unset until registration, so nothing leaves the fan-in before it. */
  isConsented?: () => boolean
  /** The same gate read fresh, at the moment a queued batch would leave the process. */
  isSendAllowed?: () => boolean
  /** Empties the native SDK queue without sending it; set while a native transport is live. */
  dropQueued?: () => void
}

export const SUMMARY_SHUTDOWN_WAIT_MS = 1_000

export function createNativeSummaryRecorder(input: {
  readonly state: NativeCaptureState
  readonly consent: Pick<SessionSummaryOptions, "isConsented" | "consentScope" | "isScopeConsented" | "scheduleConsentCheck">
  readonly stateDir: string
  readonly env: TelemetryEnv
  readonly cwd: string | undefined
  readonly sessionRole: TelemetrySessionRole
  readonly rawTurnSampleRate?: number
  readonly isPidAlive?: (pid: number) => boolean
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly loadRecovery?: SessionSummaryOptions["loadRecovery"]
  readonly loadRuntime?: LoadSummaryRuntime
}): SessionSummaryRecorder {
  const { state, env } = input
  let configuredRate = input.rawTurnSampleRate
  // The sink is fixed to PostHog until `telemetry.sink` exists; the collector sink forces 1.
  const sampleRate = (): number =>
    (configuredRate ??= resolveRawTurnSampleRate({ sink: "posthog", configured: configuredSampleRate(input.cwd, env), env }))
  // The recorder, its storage and its publisher live in the sidecar: a session loads them on its first turn,
  // recovery or shutdown, so starting the extension costs only this facade. Nothing reaches the disk before that.
  let loading: Promise<SessionSummaryRecorder | undefined> | undefined
  let loaded: SessionSummaryRecorder | undefined
  const recorder = (): Promise<SessionSummaryRecorder | undefined> =>
    (loading ??= (input.loadRuntime ?? loadSummaryRuntime)().then(
      (runtime) =>
        (loaded = runtime.createSessionSummaryRecorder({
          ...input.consent,
          storage: runtime.createSummaryStorage({
            stateDir: input.stateDir,
            owner: runtime.currentProcessOwner(),
            ...(input.isPidAlive === undefined ? {} : { isPidAlive: input.isPidAlive }),
          }),
          publish: state,
          sessionRole: input.sessionRole,
          sampleRate,
          ...(input.diagnostics === undefined ? {} : { diagnostics: input.diagnostics }),
          ...(input.loadRecovery === undefined ? {} : { loadRecovery: input.loadRecovery }),
        })),
      (error: unknown) => {
        loading = undefined
        input.diagnostics?.({ event: "telemetry_capture_failed", source: "omo-native-summary", error, errorKind: error instanceof Error ? "error" : "non_error" })
        return undefined
      },
    ))
  return {
    get sampleRate() {
      return sampleRate()
    },
    isRawTurnSampled: (sessionHash) => isSessionSampled(sessionHash, sampleRate()),
    recover: async () => {
      if (input.consent.isConsented?.() === false) return
      await (await recorder())?.recover()
    },
    // Once loaded, calls go straight through, so a turn's window is written before recordTurn returns.
    recordTurn: (sessionHash, turn) =>
      loaded !== undefined ? loaded.recordTurn(sessionHash, turn) : recorder().then((late) => late?.recordTurn(sessionHash, turn)),
    finish: (sessionHash, reason) =>
      loaded !== undefined ? loaded.finish(sessionHash, reason) : recorder().then((late) => late?.finish(sessionHash, reason)),
    prepare: async () => {
      await recorder()
    },
    purgeIfOptedOut: () => loaded?.purgeIfOptedOut(),
    dispose: () => {
      loaded?.dispose()
      void loading?.then((late) => late?.dispose())
    },
  }
}

// `telemetry.rawTurnSampleRate` from omo.json; an unreadable config leaves the documented default.
function configuredSampleRate(cwd: string | undefined, env: TelemetryEnv): number | undefined {
  try {
    return loadSenpiOmoConfig({ env: { ...env }, ...(cwd === undefined ? {} : { cwd }) }).config.telemetry?.rawTurnSampleRate
  } catch {
    return undefined
  }
}

export async function settleWithin(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([work, new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })])
  clearTimeout(timer)
}
