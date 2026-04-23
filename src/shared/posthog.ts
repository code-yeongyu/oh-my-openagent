import os from "os"
import { createHash } from "node:crypto"
import { PostHog } from "posthog-node"
import packageJson from "../../package.json" with { type: "json" }
import { PLUGIN_NAME, PUBLISHED_PACKAGE_NAME } from "./plugin-identity"
import { getPostHogActivityCaptureState } from "./posthog-activity-state"

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com"
const DEFAULT_POSTHOG_API_KEY = "phc_CFJhj5HyvA62QPhvyaUCtaq23aUfznnijg5VaaGkNk74"

type PostHogCaptureEvent = Parameters<PostHog["capture"]>[0]
type PostHogExceptionProperties = Parameters<PostHog["captureException"]>[2]
type PostHogSource = "cli" | "plugin"
type PostHogActivityReason = "run_started" | "plugin_loaded"

type PostHogClient = {
  capture: (message: PostHogCaptureEvent) => void
  captureException: (
    error: unknown,
    distinctId?: string,
    additionalProperties?: PostHogExceptionProperties,
  ) => void
  trackActive: (distinctId: string, reason: PostHogActivityReason) => void
  shutdown: () => Promise<void>
}

const NO_OP_POSTHOG: PostHogClient = {
  capture: () => undefined,
  captureException: () => undefined,
  trackActive: () => undefined,
  shutdown: async () => undefined,
}

function isFalsy(value: string | undefined): boolean {
  return value === "0" || value === "false" || value === "no"
}

function shouldDisablePostHog(): boolean {
  if (process.env.OMO_DISABLE_POSTHOG === "true" || process.env.OMO_DISABLE_POSTHOG === "1") {
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
  return process.env.POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST
}

function getSharedProperties(source: PostHogSource): NonNullable<PostHogCaptureEvent["properties"]> {
  return {
    platform: "oh-my-opencode",
    package_name: PUBLISHED_PACKAGE_NAME,
    plugin_name: PLUGIN_NAME,
    package_version: packageJson.version,
    runtime: "bun",
    runtime_version: process.versions.bun ?? process.version,
    source,
    $os: os.platform(),
    $os_version: os.release(),
    os_arch: os.arch(),
    os_type: os.type(),
    cpu_count: os.cpus().length,
    cpu_model: os.cpus()[0]?.model,
    total_memory_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
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

  let configuredClient: PostHog

  try {
    configuredClient = new PostHog(getPostHogApiKey(), {
      ...options,
      host: getPostHogHost(),
      disableGeoip: false,
    })
  } catch {
    return NO_OP_POSTHOG
  }
  const sharedProperties = getSharedProperties(source)

  return {
    capture: (message) => {
      configuredClient.capture({
        ...message,
        properties: {
          ...sharedProperties,
          ...message.properties,
        },
      })
    },
    captureException: (error, distinctId, additionalProperties) => {
      configuredClient.captureException(error, distinctId, {
        ...sharedProperties,
        ...additionalProperties,
      })
    },
    trackActive: (distinctId, reason) => {
      const activityState = getPostHogActivityCaptureState()

      if (activityState.captureDaily) {
        configuredClient.capture({
          distinctId,
          event: "omo_daily_active",
          properties: {
            ...sharedProperties,
            day_utc: activityState.dayUTC,
            reason,
          },
        })
      }

      if (activityState.captureHourly) {
        configuredClient.capture({
          distinctId,
          event: "omo_hourly_active",
          properties: {
            ...sharedProperties,
            hour_utc: activityState.hourUTC,
            reason,
          },
        })
      }
    },
    shutdown: async () => configuredClient.shutdown(),
  }
}

export function getPostHogDistinctId(): string {
  return createHash("sha256")
    .update(`${PUBLISHED_PACKAGE_NAME}:${os.hostname()}`)
    .digest("hex")
}

export function createCliPostHog(): PostHogClient {
  return createPostHogClient("cli", {
    enableExceptionAutocapture: false,
    flushAt: 1,
    flushInterval: 0,
  })
}

export function createPluginPostHog(): PostHogClient {
  return createPostHogClient("plugin", {
    enableExceptionAutocapture: false,
    flushAt: 1,
    flushInterval: 0,
  })
}
