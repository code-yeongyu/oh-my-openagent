import { isOtlpTransportAllowed } from "./otlp-gate"
import { purgeReport, purgeSpool } from "./otlp-spool-purge"
import type { CreateOtlpTelemetryTransportInput, OtlpTelemetryTransport } from "./otlp-transport-types"

// The `@oh-my-opencode/telemetry-core/otlp` entry. It reads the opt-outs and consent with no OpenTelemetry or
// protobuf code loaded; only an enabled, consented run imports the sender. A disabled run creates nothing
// on disk and deletes what earlier consented runs left in the spool (see `purgeSpool` for the race rules).

export {
  DEFAULT_OTLP_ENDPOINT,
  isOtlpTelemetryEnabled,
  isWireAttributeKey,
  resolveOtlpEndpoint,
  type OtlpWireProjection,
  type WireAttributes,
} from "./otlp-config"
export type { CreateOtlpTelemetryTransportInput, OtlpTelemetryTransport } from "./otlp-transport-types"
export type { SpanAllowlist } from "./otlp-wal"

/** The collector transport, or null whenever an opt-out applies or consent is not given. */
export async function createOtlpTelemetryTransport(input: CreateOtlpTelemetryTransportInput): Promise<OtlpTelemetryTransport | null> {
  if (!isOtlpTransportAllowed(input)) {
    purgeOnOptOut(input)
    return null
  }
  const { startOtlpTransport } = await import("./otlp-sender")
  return startOtlpTransport(input)
}

function purgeOnOptOut(input: CreateOtlpTelemetryTransportInput): void {
  const source = input.source ?? "otlp"
  try {
    if (purgeSpool(input.spoolDir, input.spoolRoot, purgeReport(input.diagnostics, source)) === "refused") {
      input.diagnostics?.({ event: "telemetry_spool_purge_refused", source })
    }
  } catch (error) {
    input.diagnostics?.({ event: "telemetry_spool_sweep_failed", source, error, errorKind: error instanceof Error ? "error" : "non_error" })
  }
}
