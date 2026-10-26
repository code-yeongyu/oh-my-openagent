import { isOtlpTelemetryEnabled } from "./otlp-config"
import type { CreateOtlpTelemetryTransportInput } from "./otlp-transport-types"

/**
 * Whether an OTLP transport may start: no opt-out applies (`DO_NOT_TRACK`, `OTEL_SDK_DISABLED=true`, the
 * product opt-out) and `consent()` is true. A consent callback that throws counts as no consent.
 * Node built-ins and otlp-config only, so the check loads no OpenTelemetry or protobuf code.
 */
export function isOtlpTransportAllowed(input: CreateOtlpTelemetryTransportInput): boolean {
  if (!isOtlpTelemetryEnabled({ env: input.env ?? process.env, productEnvPrefix: input.productEnvPrefix })) return false
  return safeConsent(input)()
}

/** `consent()` with the gate's rule applied on every call: a callback that throws counts as no consent. */
export function safeConsent(input: CreateOtlpTelemetryTransportInput): () => boolean {
  const consent = input.consent
  if (consent === undefined) return () => true
  return () => {
    try {
      return consent()
    } catch (error) {
      input.diagnostics?.({ event: "telemetry_consent_failed", source: input.source ?? "otlp", error, errorKind: error instanceof Error ? "error" : "non_error" })
      return false
    }
  }
}
