import { getTelemetryApiKey, getTelemetryHost } from "./env"
import { createDefaultPostHogTransport, isTelemetryClientEnabled } from "./posthog-client"
import type {
  TelemetryCaptureMessage,
  TelemetryDiagnosticEvent,
  TelemetryDiagnosticInput,
  TelemetryEnv,
  TelemetryProductConfig,
  TelemetryTransport,
  TelemetryTransportFactory,
  TelemetryTransportOptions,
} from "./types"

export type EventPropertyAllowlist = Readonly<Record<string, readonly string[]>>
export type EventTelemetryProperties = Readonly<Record<string, unknown>>
export type EventTelemetrySetTimeout = (callback: () => void, delay: number) => unknown

export type CreateEventTelemetryClientInput = {
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly distinctId: string
  readonly env?: TelemetryEnv
  readonly onCapture?: (payload: TelemetryCaptureMessage) => void
  readonly product: TelemetryProductConfig
  readonly propertyAllowlist: EventPropertyAllowlist
  readonly schemaVersion: number
  readonly setTimeoutFn?: EventTelemetrySetTimeout
  readonly source: string
  readonly transportFactory?: TelemetryTransportFactory
}

export type EventTelemetryClient = {
  readonly enabled: boolean
  readonly captureEvent: (name: string, properties: EventTelemetryProperties) => void
  readonly flush: () => Promise<void>
  readonly shutdown: () => Promise<void>
}

// Applied LAST, so a product cannot weaken them. `disableGeoip: false` lets PostHog derive
// `$geoip_country_code` from the transport source IP server-side, which is the only honest way to
// answer a per-country question: a device timezone is not a country (countries share zones, span
// zones, and users override them). The application still never AUTHORS an ip - `$ip` stays a
// rejected key - stores none itself, and keeps `$process_person_profile` false.
const EVENT_TRANSPORT_OVERRIDES = {
  disableGeoip: false,
  flushAt: 20,
  flushInterval: 10_000,
} as const
const SHUTDOWN_TIMEOUT_MS = 1_000
const ALLOWED_DOLLAR_KEYS = new Set([
  "$os",
  "$os_version",
  "$process_person_profile",
  "$session_id",
])
const FORBIDDEN_SUFFIX = /_(?:text|path|prompt)$/

const NO_OP_EVENT_CLIENT: EventTelemetryClient = {
  enabled: false,
  captureEvent: () => undefined,
  flush: async () => undefined,
  shutdown: async () => undefined,
}

export function createEventTelemetryClient(
  input: CreateEventTelemetryClientInput,
): EventTelemetryClient {
  if (!isTelemetryClientEnabled(input)) {
    return NO_OP_EVENT_CLIENT
  }

  const transport = createEventTransport(input)
  if (transport === null) {
    return NO_OP_EVENT_CLIENT
  }

  const allowlists = new Map(
    Object.entries(input.propertyAllowlist).map(([name, keys]) => [name, new Set(keys)]),
  )
  const sharedProperties = {
    // Spread first: a product may extend the shared block (omo-native attribution rides here),
    // but it can never override the fixed identity keys below.
    ...input.product.additionalProperties,
    platform: input.product.platform,
    product_name: input.product.productName,
    package_version: input.product.packageVersion,
    schema_version: input.schemaVersion,
    $process_person_profile: false,
  } as const

  const report = (event: TelemetryDiagnosticEvent, error?: unknown): void => {
    input.diagnostics?.({
      event,
      source: input.source,
      error,
      errorKind: error === undefined ? undefined : error instanceof Error ? "error" : "non_error",
    })
  }

  const flush = async (): Promise<void> => {
    if (transport.flush === undefined) {
      return
    }
    try {
      await transport.flush()
    } catch (error) {
      report("telemetry_shutdown_failed", error)
    }
  }

  return {
    enabled: true,
    captureEvent(name, properties) {
      const allowlist = allowlists.get(name)
      if (name.length === 0 || allowlist === undefined) {
        report("telemetry_event_rejected", new Error("event name is empty or not allowlisted"))
        return
      }

      const projected: Record<string, string | number | boolean> = {}
      for (const [key, value] of Object.entries(properties)) {
        if (isForbiddenKey(key, value)) {
          report("telemetry_event_property_rejected", new Error(`forbidden event property: ${key}`))
          continue
        }
        if (!allowlist.has(key)) {
          report("telemetry_event_property_dropped", new Error(`unknown event property: ${key}`))
          continue
        }
        if (!isEventPropertyValue(value)) {
          report("telemetry_event_property_rejected", new Error(`invalid event property value: ${key}`))
          continue
        }
        projected[key] = typeof value === "string" ? value.slice(0, 64) : value
      }

      const payload: TelemetryCaptureMessage = {
        distinctId: input.distinctId,
        event: name,
        properties: { ...projected, ...sharedProperties },
      }
      try {
        transport.capture(payload)
        input.onCapture?.(payload)
      } catch (error) {
        report("telemetry_capture_failed", error)
      }
    },
    flush,
    async shutdown() {
      const setTimeoutFn = input.setTimeoutFn ?? setTimeout
      let timeoutHandle: unknown
      const timeout = new Promise<void>((resolve) => {
        timeoutHandle = setTimeoutFn(resolve, SHUTDOWN_TIMEOUT_MS)
      })
      const finalize = async (): Promise<void> => {
        await flush()
        try {
          await transport.shutdown()
        } catch (error) {
          report("telemetry_shutdown_failed", error)
        }
      }
      await Promise.race([finalize(), timeout])
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle as ReturnType<typeof setTimeout>)
      }
    },
  }
}

function createEventTransport(input: CreateEventTelemetryClientInput): TelemetryTransport | null {
  const env = input.env ?? process.env
  const factory = input.transportFactory ?? createDefaultPostHogTransport
  const options: TelemetryTransportOptions = {
    enableExceptionAutocapture: false,
    enableLocalEvaluation: false,
    strictLocalEvaluation: true,
    disableRemoteConfig: true,
    host: getTelemetryHost(env, input.product.defaultHost),
    ...input.product.transportOptions,
    ...EVENT_TRANSPORT_OVERRIDES,
  }
  try {
    return factory(getTelemetryApiKey(env, input.product.defaultApiKey), options)
  } catch (error) {
    input.diagnostics?.({
      event: "telemetry_posthog_init_failed",
      source: input.source,
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
    return null
  }
}

function isForbiddenKey(key: string, value: unknown): boolean {
  return (
    key === "$ip" ||
    (typeof value === "string" && FORBIDDEN_SUFFIX.test(key)) ||
    (key.startsWith("$") && !ALLOWED_DOLLAR_KEYS.has(key))
  )
}

function isEventPropertyValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
}
