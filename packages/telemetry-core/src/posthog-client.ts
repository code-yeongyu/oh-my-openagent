import { PostHog } from "posthog-node"

import { getTelemetryApiKey, getTelemetryHost, shouldDisableTelemetry } from "./env"
import { getDefaultTelemetryOsProvider } from "./machine-id"
import type {
  TelemetryCaptureProperties,
  TelemetryClient,
  TelemetryDiagnosticInput,
  TelemetryEnv,
  TelemetryOsProvider,
  TelemetryProductConfig,
  TelemetryTransport,
  TelemetryTransportFactory,
  TelemetryTransportOptions,
} from "./types"

type CreateTelemetryClientInput = {
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly env?: TelemetryEnv
  readonly osProvider?: TelemetryOsProvider
  readonly product: TelemetryProductConfig
  readonly source: string
  readonly transportFactory?: TelemetryTransportFactory
}

export type TelemetryClientEnabledInput = {
  readonly env?: TelemetryEnv
  readonly product: Pick<TelemetryProductConfig, "defaultApiKey" | "productEnvPrefix">
}

const NO_OP_CLIENT: TelemetryClient = {
  enabled: false,
  trackActive: () => undefined,
  flush: async () => undefined,
  shutdown: async () => undefined,
}

class PostHogTelemetryTransport implements TelemetryTransport {
  readonly #client: PostHog

  constructor(apiKey: string, options: TelemetryTransportOptions) {
    this.#client = new PostHog(apiKey, options)
  }

  capture(message: Parameters<PostHog["capture"]>[0]): void {
    this.#client.capture(message)
  }

  async flush(): Promise<void> {
    await this.#client.flush()
  }

  async shutdown(): Promise<void> {
    await this.#client.shutdown()
  }
}

export function createDefaultPostHogTransport(
  apiKey: string,
  options: TelemetryTransportOptions,
): TelemetryTransport {
  return new PostHogTelemetryTransport(apiKey, options)
}

export function isTelemetryClientEnabled(input: TelemetryClientEnabledInput): boolean {
  const env = input.env ?? process.env
  return (
    !shouldDisableTelemetry({ env, productEnvPrefix: input.product.productEnvPrefix }) &&
    getTelemetryApiKey(env, input.product.defaultApiKey).length > 0
  )
}

export function createTelemetryClient(input: CreateTelemetryClientInput): TelemetryClient {
  if (!isTelemetryClientEnabled(input)) {
    return NO_OP_CLIENT
  }

  const transport = createTransport(input)
  if (transport === null) {
    return NO_OP_CLIENT
  }

  const sharedProperties = getSharedProperties(input)

  return {
    enabled: true,
    trackActive: ({ dayUTC, distinctId, reason }) => {
      try {
        transport.capture({
          distinctId,
          event: input.product.eventName,
          properties: {
            ...sharedProperties,
            $process_person_profile: false,
            day_utc: dayUTC,
            reason,
          },
        })
      } catch (error) {
        input.diagnostics?.({
          event: "telemetry_capture_failed",
          source: input.source,
          error,
          errorKind: error instanceof Error ? "error" : "non_error",
        })
      }
    },
    flush: async () => {
      if (transport.flush === undefined) {
        return
      }
      await transport.flush()
    },
    shutdown: async () => {
      try {
        await transport.shutdown()
      } catch (error) {
        input.diagnostics?.({
          event: "telemetry_shutdown_failed",
          source: input.source,
          error,
          errorKind: error instanceof Error ? "error" : "non_error",
        })
      }
    },
  }
}

function createTransport(input: CreateTelemetryClientInput): TelemetryTransport | null {
  const env = input.env ?? process.env
  const factory = input.transportFactory ?? createDefaultPostHogTransport

  try {
    return factory(getTelemetryApiKey(env, input.product.defaultApiKey), {
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
      strictLocalEvaluation: true,
      disableRemoteConfig: true,
      flushAt: 1,
      flushInterval: 0,
      host: getTelemetryHost(env, input.product.defaultHost),
      disableGeoip: false,
    })
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

function getSharedProperties(input: CreateTelemetryClientInput): TelemetryCaptureProperties {
  const osProvider = input.osProvider ?? getDefaultTelemetryOsProvider()
  const cpuInfo = getSafeCpuInfo(osProvider, input)
  return {
    platform: input.product.platform,
    product_name: input.product.productName,
    package_name: input.product.packageName,
    package_version: input.product.packageVersion,
    runtime: "bun",
    runtime_version: process.versions.bun ?? process.version,
    source: input.source,
    $os: osProvider.platform(),
    $os_version: osProvider.release(),
    os_arch: osProvider.arch(),
    os_type: osProvider.type(),
    cpu_count: cpuInfo.count,
    cpu_model: cpuInfo.model,
    total_memory_gb: Math.round(osProvider.totalmem() / 1024 / 1024 / 1024),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    shell: process.env.SHELL,
    ci: Boolean(process.env.CI),
    terminal: process.env.TERM_PROGRAM,
    ...input.product.additionalProperties,
  }
}

function getSafeCpuInfo(
  osProvider: TelemetryOsProvider,
  input: CreateTelemetryClientInput,
): { readonly count: number; readonly model: string | undefined } {
  try {
    const cpuInfo = osProvider.cpus()
    return {
      count: cpuInfo.length,
      model: cpuInfo[0]?.model,
    }
  } catch (error) {
    input.diagnostics?.({
      event: "telemetry_cpu_info_unavailable",
      source: "shared",
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
    return {
      count: 0,
      model: undefined,
    }
  }
}
