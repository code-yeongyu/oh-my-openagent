import { isOtlpTransportAllowed } from "./otlp-gate"
import type { CreateOtlpTelemetryTransportInput, OtlpTelemetryTransport } from "./otlp-transport-types"

/**
 * The only way to start the OTLP runtime. It checks every opt-out and consent itself, before any
 * OpenTelemetry, protobuf or spool code loads: on a disabled run it returns null, loads nothing more and
 * writes nothing. Callers outside this package go through `createOtlpTelemetryTransport` (the `./otlp` entry).
 */
export async function startOtlpTransport(input: CreateOtlpTelemetryTransportInput): Promise<OtlpTelemetryTransport | null> {
  if (!isOtlpTransportAllowed(input)) return null
  const { createOtlpSender } = await import("./otlp-sender-core")
  return createOtlpSender(input)
}
