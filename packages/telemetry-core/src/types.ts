import type { PostHog } from "posthog-node"

export type TelemetryCaptureMessage = Parameters<PostHog["capture"]>[0]
export type TelemetryCaptureProperties = NonNullable<TelemetryCaptureMessage["properties"]>

export type TelemetryDiagnosticEvent =
  | "telemetry_activity_state_read_failed"
  | "telemetry_activity_state_write_failed"
  | "telemetry_capture_failed"
  | "telemetry_cpu_info_unavailable"
  | "telemetry_posthog_import_failed"
  | "telemetry_posthog_init_failed"
  | "telemetry_shutdown_failed"

export type TelemetryDiagnosticErrorKind = "error" | "non_error"

export type TelemetryDiagnosticInput = {
  readonly event: TelemetryDiagnosticEvent
  readonly source: string
  readonly error?: unknown
  readonly errorKind?: TelemetryDiagnosticErrorKind
}

export type TelemetryProductConfig = {
  readonly cacheDirName: string
  readonly defaultApiKey: string
  readonly defaultHost: string
  readonly eventName: string
  readonly machineIdPrefix: string
  readonly packageName: string
  readonly packageVersion: string
  readonly platform: string
  readonly productEnvPrefix: string
  readonly productName: string
  readonly additionalProperties?: TelemetryCaptureProperties
}

export type TelemetryOsProvider = {
  readonly arch: () => string
  readonly cpus: () => readonly { readonly model: string }[]
  readonly hostname: () => string
  readonly platform: () => NodeJS.Platform
  readonly release: () => string
  readonly totalmem: () => number
  readonly type: () => string
}

export type TelemetryEnv = Readonly<Record<string, string | undefined>>

export type TelemetryTransportOptions = {
  readonly host: string
  readonly disableGeoip: boolean
  readonly enableExceptionAutocapture: boolean
  readonly enableLocalEvaluation: boolean
  readonly strictLocalEvaluation: boolean
  readonly disableRemoteConfig: boolean
  readonly flushAt: number
  readonly flushInterval: number
}

export type TelemetryTransport = {
  readonly capture: (message: TelemetryCaptureMessage) => void
  readonly flush?: () => Promise<void>
  readonly shutdown: () => Promise<void>
}

export type TelemetryTransportFactory = (
  apiKey: string,
  options: TelemetryTransportOptions,
) => TelemetryTransport

export type TelemetryClient = {
  readonly enabled: boolean
  readonly trackActive: (input: {
    readonly dayUTC: string
    readonly distinctId: string
    readonly reason: string
  }) => void
  readonly flush: () => Promise<void>
  readonly shutdown: () => Promise<void>
}
