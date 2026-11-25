import { DEFAULT_POSTHOG_HOST } from "./constants"
import { DEFAULT_OTLP_ENDPOINT } from "./otlp-config"

export { DEFAULT_OTLP_ENDPOINT }

export type TelemetryDestination = {
  readonly kind: "posthog" | "otlp"
  readonly label: string
  readonly host: string
}

// Safe on the PostHog-only main barrel: this module imports two string constants and no OpenTelemetry code.
export const TELEMETRY_DESTINATIONS: readonly TelemetryDestination[] = [
  { kind: "posthog", label: "PostHog in the United States", host: DEFAULT_POSTHOG_HOST },
  { kind: "otlp", label: "the OmO telemetry collector", host: DEFAULT_OTLP_ENDPOINT },
]

export function telemetryDestinationHosts(): readonly string[] {
  return TELEMETRY_DESTINATIONS.map((destination) => destination.host)
}
