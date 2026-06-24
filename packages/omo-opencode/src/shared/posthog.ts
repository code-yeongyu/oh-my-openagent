import os from "os"
import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  createDefaultPostHogTransport,
  getTelemetryDistinctId,
  getTelemetryHost,
} from "@oh-my-opencode/telemetry-core"
import type {
  TelemetryCaptureMessage,
  TelemetryTransport,
  TelemetryTransportFactory,
  TelemetryTransportOptions,
} from "@oh-my-opencode/telemetry-core"
import packageJson from "../../../../package.json" with { type: "json" }
import { PLUGIN_NAME, PUBLISHED_PACKAGE_NAME } from "./plugin-identity"
import { getPostHogActivityCaptureState } from "./posthog-activity-state"

/** @internal test-only seam: keep null in production to use the real implementation. */
let activityStateProviderOverride: typeof getPostHogActivityCaptureState | null = null
type OsProvider = Pick<typeof os, "arch" | "cpus" | "hostname" | "platform" | "release" | "totalmem" | "type">
let osProviderOverride: OsProvider | null = null
let transportFactoryOverride: TelemetryTransportFactory | null = null

function resolveActivityState(): ReturnType<typeof getPostHogActivityCaptureState> {
  return (activityStateProviderOverride ?? getPostHogActivityCaptureState)()
}

function resolveOsProvider(): OsProvider {
  return osProviderOverride ?? os
}

function resolveTransportFactory(): TelemetryTransportFactory {
  return transportFactoryOverride ?? createDefaultPostHogTransport
}

/** @internal test-only */
export function __setActivityStateProviderForTesting(
  provider: typeof getPostHogActivityCaptureState,
): void {
  activityStateProviderOverride = provider
}

/** @internal test-only */
export function __resetActivityStateProviderForTesting(): void {
  activityStateProviderOverride = null
}

/** @internal test-only */
export function __setOsProviderForTesting(provider: OsProvider): void {
  osProviderOverride = provider
}

/** @internal test-only */
export function __resetOsProviderForTesting(): void {
  osProviderOverride = null
}

export function __setTransportFactoryForTesting(provider: TelemetryTransportFactory): void {
  transportFactoryOverride = provider
}

export function __resetTransportFactoryForTesting(): void {
  transportFactoryOverride = null
}

type PostHogCaptureProperties = NonNullable<TelemetryCaptureMessage["properties"]>
type PostHogSource = "cli" | "plugin"
type PostHogActivityReason = "run_started"

type PostHogClient = {
  trackActive: (distinctId: string, reason: PostHogActivityReason) => void
  shutdown: () => Promise<void>
}

const NO_OP_POSTHOG: PostHogClient = {
  trackActive: () => undefined,
  shutdown: async () => undefined,
}

function isFalsy(value: string | undefined): boolean {
  return value === "0" || value === "false" || value === "no"
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes"
}

function shouldDisablePostHog(): boolean {
  if (isTruthy(process.env.OMO_DISABLE_POSTHOG?.trim().toLowerCase())) {
    return true
  }

  return isFalsy(process.env.OMO_SEND_ANONYMOUS_TELEMETRY?.trim().toLowerCase())
}

function hasPostHogApiKey(): boolean {
  return getPostHogApiKey().length > 0
}

function getPostHogApiKey(): string {
  return process.env.POSTHOG_API_KEY?.trim() || DEFAULT_POSTHOG_API_KEY
}

function getPostHogHost(): string {
  return getTelemetryHost(process.env, DEFAULT_POSTHOG_HOST)
}

function safeCpus(): { length: number; model: string | undefined } {
  try {
    const cpus = resolveOsProvider().cpus()
    return { length: cpus.length, model: cpus[0]?.model }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return { length: 0, model: undefined }
  }
}

function getSharedProperties(source: PostHogSource): PostHogCaptureProperties {
  const cpus = safeCpus()
  const osProvider = resolveOsProvider()

  return {
    platform: "oh-my-opencode",
    package_name: PUBLISHED_PACKAGE_NAME,
    plugin_name: PLUGIN_NAME,
    package_version: packageJson.version,
    runtime: "bun",
    runtime_version: process.versions.bun ?? process.version,
    source,
    $os: osProvider.platform(),
    $os_version: osProvider.release(),
    os_arch: osProvider.arch(),
    os_type: osProvider.type(),
    cpu_count: cpus.length,
    cpu_model: cpus.model,
    total_memory_gb: Math.round(osProvider.totalmem() / 1024 / 1024 / 1024),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    shell: process.env.SHELL,
    ci: Boolean(process.env.CI),
    terminal: process.env.TERM_PROGRAM,
  }
}

function createPostHogClient(
  source: PostHogSource,
  options: Omit<TelemetryTransportOptions, "disableGeoip" | "host">,
): PostHogClient {
  if (shouldDisablePostHog() || !hasPostHogApiKey()) {
    return NO_OP_POSTHOG
  }

  let configuredClient: TelemetryTransport

  try {
    configuredClient = resolveTransportFactory()(getPostHogApiKey(), {
      ...options,
      host: getPostHogHost(),
      disableGeoip: false,
    })
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return NO_OP_POSTHOG
  }
  const sharedProperties = getSharedProperties(source)

  return {
    trackActive: (distinctId, reason) => {
      const activityState = resolveActivityState()

      if (activityState.captureDaily) {
        try {
          configuredClient.capture({
            distinctId,
            event: "omo_daily_active",
            properties: {
              ...sharedProperties,
              $process_person_profile: false,
              day_utc: activityState.dayUTC,
              reason,
            },
          })
        } catch (error) {
          if (error instanceof Error) {
            return
          }
          return
        }
      }
    },
    shutdown: async () => {
      try {
        await configuredClient.shutdown()
      } catch (error) {
        if (error instanceof Error) {
          return
        }
        return
      }
    },
  }
}

export function getPostHogDistinctId(): string {
  return getTelemetryDistinctId(`${PUBLISHED_PACKAGE_NAME}:`, resolveOsProvider())
}

export function createCliPostHog(): PostHogClient {
  return createPostHogClient("cli", {
    enableExceptionAutocapture: false,
    enableLocalEvaluation: false,
    strictLocalEvaluation: true,
    disableRemoteConfig: true,
    flushAt: 1,
    flushInterval: 0,
  })
}

export function createPluginPostHog(): PostHogClient {
  return createPostHogClient("plugin", {
    enableExceptionAutocapture: false,
    enableLocalEvaluation: false,
    strictLocalEvaluation: true,
    disableRemoteConfig: true,
    flushAt: 1,
    flushInterval: 0,
  })
}
