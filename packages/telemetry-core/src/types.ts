import type { PostHog, PostHogOptions } from "posthog-node"

export type TelemetryCaptureMessage = Parameters<PostHog["capture"]>[0]
export type TelemetryCaptureProperties = NonNullable<TelemetryCaptureMessage["properties"]>

export type TelemetryDiagnosticEvent =
  | "telemetry_buffer_overflow"
  | "telemetry_activity_state_read_failed"
  | "telemetry_activity_state_write_failed"
  | "telemetry_capture_failed"
  | "telemetry_consent_failed"
  | "telemetry_cpu_info_unavailable"
  | "telemetry_drop_flush_failed"
  | "telemetry_event_property_dropped"
  | "telemetry_event_property_rejected"
  | "telemetry_event_rejected"
  | "telemetry_events_dropped_by_consent"
  | "telemetry_legacy_rollups_removed"
  | "telemetry_otlp_partial_success"
  | "telemetry_otlp_send_failed"
  | "telemetry_posthog_import_failed"
  | "telemetry_posthog_init_failed"
  | "telemetry_shutdown_failed"
  | "telemetry_spool_purge_failed"
  | "telemetry_spool_purge_refused"
  | "telemetry_spool_purge_skipped"
  | "telemetry_spool_sweep_failed"
  | "telemetry_spool_write_failed"

export type TelemetryDiagnosticErrorKind = "error" | "non_error"

/** Why the opt-out purge left a spool-named entry in place: it deletes only regular files of the current user. */
export type TelemetrySpoolEntryKind = "directory" | "symlink" | "foreign_owner" | "other"

export type TelemetryDiagnosticInput = {
  readonly event: TelemetryDiagnosticEvent
  readonly source: string
  readonly error?: unknown
  readonly errorKind?: TelemetryDiagnosticErrorKind
  /** `telemetry_spool_purge_skipped` only: what kind of spool-named entry the purge left in place. */
  readonly entryKind?: TelemetrySpoolEntryKind
  /**
   * `telemetry_spool_purge_failed` only: the errno code (never the path) of one spool file of the
   * current user that the opt-out purge could not delete. One event per file, so the count is the
   * number of files left. The opt-out is then incomplete: those files stay on disk until a later
   * opted-out start purges them again, which needs the cause removed first (for EPERM, an immutable
   * or append-only flag; for EACCES, the spool directory's permissions; for EBUSY, the process
   * holding the file).
   */
  readonly errorCode?: string
  readonly count?: number
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
  readonly disableGeoip?: boolean
  readonly transportOptions?: Partial<TelemetryTransportOptions>
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
  readonly fetch?: TelemetryFetch
}

/** The SDK's public network seam: every batch it sends, timer, size or shutdown flush, goes through it. */
export type TelemetryFetch = NonNullable<PostHogOptions["fetch"]>

export type TurnSpanStatus = "ok" | "error"
export type TurnSpanAttributes = Readonly<Record<string, string | number | boolean>>

export type TurnSpanStart = {
  readonly attributes: TurnSpanAttributes
  /** The delegating turn's W3C traceparent carried across the task bridge; invalid values are ignored. */
  readonly parentTraceparent?: string
}

/** One live `omo.turn` span: lowercase hex ids, its own `traceparent`, and a scope that makes it active. */
export type TurnSpanHandle = {
  readonly traceId: string
  readonly spanId: string
  readonly traceparent: string
  readonly run: <T>(fn: () => T) => T
  readonly setAttributes: (attributes: TurnSpanAttributes) => void
  readonly end: (status: TurnSpanStatus) => void
}

/** Present only on a transport with a span sink (the collector); undefined from `startTurn` while telemetry is off. */
export type TurnTracing = {
  readonly startTurn: (start: TurnSpanStart) => TurnSpanHandle | undefined
}

export type TelemetryTransport = {
  readonly capture: (message: TelemetryCaptureMessage) => void
  /**
   * Sends one event now; resolves only on a 2xx answer and rejects otherwise (the default PostHog transport
   * rejects with `TelemetryDeliveryError`, whose `permanent` flag says a retry can never succeed).
   */
  readonly captureImmediate?: (message: TelemetryCaptureMessage) => Promise<void>
  readonly flush?: () => Promise<void>
  readonly shutdown: () => Promise<void>
  readonly traces?: TurnTracing
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
