import { createHash } from "node:crypto"
import os from "node:os"

import { PostHog } from "posthog-node"
import packageJson from "../../package.json" with { type: "json" }

import {
  type TelemetryDiagnosticErrorKind,
  type TelemetryDiagnosticEvent,
  type TelemetryDiagnosticSource,
  writeTelemetryDiagnostic,
} from "./diagnostics"
import { getPostHogApiKey, getPostHogHost, hasPostHogApiKey, shouldDisablePostHog } from "./env-flags"
import { getPostHogActivityCaptureState } from "./posthog-activity-state"
import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  EVENT_NAME,
  PACKAGE_NAME,
  PRODUCT_NAME,
} from "./product-identity"

export { DEFAULT_POSTHOG_API_KEY, DEFAULT_POSTHOG_HOST }

export type PostHogSource = "cli" | "plugin" | "install"
export type PostHogActivityReason = "install_started" | "install_completed" | "cli_run" | "session_start"

export type PostHogClient = {
  trackActive: (distinctId: string, reason: PostHogActivityReason) => void
  shutdown: () => Promise<void>
}

type OsProvider = Pick<typeof os, "arch" | "cpus" | "hostname" | "platform" | "release" | "totalmem" | "type">
type ActivityStateProvider = typeof getPostHogActivityCaptureState

let osProviderOverride: OsProvider | null = null
let activityStateProviderOverride: ActivityStateProvider | null = null

const NO_OP_POSTHOG: PostHogClient = {
  trackActive: () => undefined,
  shutdown: async () => undefined,
}

type PostHogCaptureEvent = Parameters<PostHog["capture"]>[0]

function resolveOsProvider(): OsProvider {
  return osProviderOverride ?? os
}

function resolveActivityStateProvider(): ActivityStateProvider {
  return activityStateProviderOverride ?? getPostHogActivityCaptureState
}

function writePostHogDiagnostic(
  event: TelemetryDiagnosticEvent,
  source: TelemetryDiagnosticSource,
  error: unknown,
  errorKind: TelemetryDiagnosticErrorKind,
): void {
  writeTelemetryDiagnostic({ event, source, error, errorKind })
}

function getSafeCpuInfo(): { readonly count: number; readonly model: string | undefined } {
  try {
    const cpuInfo = resolveOsProvider().cpus()
    return {
      count: cpuInfo.length,
      model: cpuInfo[0]?.model,
    }
  } catch (error) {
    writePostHogDiagnostic("telemetry_cpu_info_unavailable", "shared", error, error instanceof Error ? "error" : "non_error")
    return {
      count: 0,
      model: undefined,
    }
  }
}

function getSharedProperties(source: PostHogSource): NonNullable<PostHogCaptureEvent["properties"]> {
  const osProvider = resolveOsProvider()
  const cpuInfo = getSafeCpuInfo()

  return {
    platform: "omo-codex",
    product_name: PRODUCT_NAME,
    package_name: PACKAGE_NAME,
    package_version: packageJson.version,
    runtime: "bun",
    runtime_version: process.versions.bun ?? process.version,
    source,
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
  }
}

function createPostHogClient(
  source: PostHogSource,
  options: ConstructorParameters<typeof PostHog>[1],
): PostHogClient {
  if (shouldDisablePostHog() || !hasPostHogApiKey()) {
    return NO_OP_POSTHOG
  }

  let client: PostHog
  try {
    client = new PostHog(getPostHogApiKey(), {
      ...options,
      host: getPostHogHost(),
      disableGeoip: false,
    })
  } catch (error) {
    writePostHogDiagnostic("telemetry_posthog_init_failed", source, error, error instanceof Error ? "error" : "non_error")
    return NO_OP_POSTHOG
  }

  const sharedProperties = getSharedProperties(source)

  return {
    trackActive: (distinctId, reason) => {
      const activityState = resolveActivityStateProvider()()
      if (!activityState.captureDaily) {
        return
      }

      try {
        client.capture({
          distinctId,
          event: EVENT_NAME,
          properties: {
            ...sharedProperties,
            $process_person_profile: false,
            day_utc: activityState.dayUTC,
            reason,
          },
        })
      } catch (error) {
        writePostHogDiagnostic("telemetry_capture_failed", source, error, error instanceof Error ? "error" : "non_error")
      }
    },
    shutdown: async () => {
      try {
        await client.shutdown()
      } catch (error) {
        writePostHogDiagnostic("telemetry_shutdown_failed", source, error, error instanceof Error ? "error" : "non_error")
      }
    },
  }
}

export function getPostHogDistinctId(): string {
  return createHash("sha256").update(`omo-codex:${resolveOsProvider().hostname()}`).digest("hex")
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

export function createInstallPostHog(): PostHogClient {
  return createPostHogClient("install", {
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

/** @internal test-only */
export function __setOsProviderForTesting(provider: OsProvider): void {
  osProviderOverride = provider
}

/** @internal test-only */
export function __resetOsProviderForTesting(): void {
  osProviderOverride = null
}

/** @internal test-only */
export function __setActivityStateProviderForTesting(provider: ActivityStateProvider): void {
  activityStateProviderOverride = provider
}

/** @internal test-only */
export function __resetActivityStateProviderForTesting(): void {
  activityStateProviderOverride = null
}
