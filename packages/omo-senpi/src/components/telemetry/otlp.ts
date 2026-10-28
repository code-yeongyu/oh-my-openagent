import type {
  TelemetryCaptureMessage, TelemetryDiagnosticInput, TelemetryEnv,
  TelemetryTransport, TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"
import { createLazyPostHogTransportFactory } from "./lazy-posthog"
import { platform } from "node:os"
import { isOtlpEvent } from "./otlp-events"

declare const OMO_TELEMETRY_INGEST_KEY: string

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
    loadOtlp: resolveIngestKey(input.env).length === 0 ? undefined : message => createSenpiOtlpTransport(input, message),
  })
}

function resolveIngestKey(env: TelemetryEnv): string {
  return (env["OMO_TELEMETRY_INGEST_KEY"]
    ?? (typeof OMO_TELEMETRY_INGEST_KEY === "string" ? OMO_TELEMETRY_INGEST_KEY : "")).trim()
}

/** Check the key before even resolving the exporter sidecar; failures stay on the OTLP branch. */
export async function createSenpiOtlpTransport(
  input: TransportInput,
  message: TelemetryCaptureMessage,
): Promise<TelemetryTransport | null> {
  const ingestKey = resolveIngestKey(input.env)
  if (ingestKey.length === 0 || !isOtlpEvent(message.event)) return null
  if (!["darwin", "linux", "win32"].includes(platform())) return null
  runtime ??= import("#omo-telemetry-otlp-runtime").catch((error: unknown) => {
    runtime = undefined
    throw error
  })
  return (await runtime).createSenpiOtlpTransport({ ...input, ingestKey }, message)
}
