import type { TelemetryProviders } from "./otel-providers"
import type { InstrumentationScope, OtelClock } from "./otel-time"
import type { OtlpWireProjection } from "./otlp-config"
import type { ResourceAttributes } from "./otlp-encode"
import type { OtlpFetch } from "./otlp-http"
import type { TelemetryDiagnosticInput, TelemetryEnv, TelemetryTransport, TurnTracing } from "./types"

export type CreateOtlpTelemetryTransportInput = {
  readonly productEnvPrefix: string
  readonly ingestKey: string
  readonly spoolDir: string
  /** Required: the opt-out purge refuses a spool dir whose real path is not strictly below this one's. */
  readonly spoolRoot: string
  readonly resource: ResourceAttributes
  readonly scope: InstrumentationScope
  readonly env?: TelemetryEnv
  readonly endpoint?: string
  readonly project?: OtlpWireProjection
  readonly consent?: () => boolean
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly source?: string
  readonly fetch?: OtlpFetch
  /** Per-request deadline, response body included (default 10 s). */
  readonly requestTimeoutMs?: number
  readonly leaseRenewIntervalMs?: number
  readonly sleep?: (ms: number, abort: AbortSignal) => Promise<void>
  readonly random?: () => number
  readonly nowMs?: () => number
  readonly clock?: OtelClock
  readonly isPidAlive?: (pid: number) => boolean
  readonly pid?: number
  readonly bootId?: string
  readonly createEventId?: () => string
  readonly autoStart?: boolean
  readonly flushAt?: number
  readonly flushIntervalMs?: number
  readonly sweepIntervalMs?: number
  readonly shutdownTimeoutMs?: number
  readonly capBytes?: number
  readonly maxAgeMs?: number
}

export type OtlpTelemetryTransport = TelemetryTransport & {
  readonly sampling: { readonly rawTurnRate: 1 }
  readonly providers: TelemetryProviders
  readonly traces: TurnTracing
  readonly endpoint: string
  readonly ready: Promise<void>
  readonly flush: () => Promise<void>
  readonly sweep: () => void
  readonly droppedEvents: () => number
}
