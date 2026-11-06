import type {
  TelemetryCaptureMessage, TelemetryDiagnosticInput, TelemetryEnv,
  TelemetryTransport, TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"
import { createLazyPostHogTransportFactory } from "./lazy-posthog"
import { platform } from "node:os"
import { isOtlpEvent } from "./otlp-events"

export type TransportInput = {
  readonly env: TelemetryEnv
  readonly consent: () => boolean
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly source?: string
}

let runtime: Promise<typeof import("#omo-telemetry-otlp-runtime")> | undefined

export function createSenpiTelemetryTransportFactory(input: TransportInput): TelemetryTransportFactory {
  return createLazyPostHogTransportFactory({
    ...input,
    isOtlpEvent,
    loadOtlp: message => createSenpiOtlpTransport(input, message),
  })
}

/** The sidecar resolves install credentials only after consent; failures stay on the OTLP branch. */
export async function createSenpiOtlpTransport(
  input: TransportInput,
  message: TelemetryCaptureMessage,
): Promise<TelemetryTransport | null> {
  if (!isOtlpEvent(message.event)) return null
  if (!["darwin", "linux", "win32"].includes(platform())) return null
  runtime ??= import("#omo-telemetry-otlp-runtime").catch((error: unknown) => {
    runtime = undefined
    throw error
  })
  return (await runtime).createSenpiOtlpTransport(input, message)
}
