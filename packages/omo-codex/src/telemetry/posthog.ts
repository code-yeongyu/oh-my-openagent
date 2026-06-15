import {
  createTelemetryClient,
  getDefaultTelemetryOsProvider,
  getDailyActiveCaptureState,
  getTelemetryDistinctId,
} from "@oh-my-opencode/telemetry-core"
import type {
  PostHogActivityCaptureState,
  TelemetryOsProvider,
  TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"

import { writeTelemetryDiagnostic } from "./diagnostics"
import { getPostHogActivityCaptureState } from "./posthog-activity-state"
import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  MACHINE_ID_PREFIX,
  createCodexTelemetryProductConfig,
} from "./product-identity"

export { DEFAULT_POSTHOG_API_KEY, DEFAULT_POSTHOG_HOST }

export type PostHogSource = "cli" | "plugin" | "install"
export type PostHogActivityReason = "install_started" | "install_completed" | "cli_run" | "session_start"

export type PostHogClient = {
  readonly trackActive: (distinctId: string, reason: PostHogActivityReason) => void
  readonly shutdown: () => Promise<void>
}

type ActivityStateProvider = () => PostHogActivityCaptureState

type CreatePostHogClientOptions = {
  readonly activityStateProvider?: ActivityStateProvider
  readonly env?: NodeJS.ProcessEnv
  readonly now?: Date
  readonly osProvider?: TelemetryOsProvider
  readonly stateDir?: string
  readonly transportFactory?: TelemetryTransportFactory
}

let osProviderOverride: TelemetryOsProvider | null = null
let activityStateProviderOverride: ActivityStateProvider | null = null

const NO_OP_POSTHOG: PostHogClient = {
  trackActive: () => undefined,
  shutdown: async () => undefined,
}

function resolveOsProvider(): TelemetryOsProvider {
  return osProviderOverride ?? getDefaultTelemetryOsProvider()
}

function resolveActivityStateProvider(options: CreatePostHogClientOptions): ActivityStateProvider {
  if (options.activityStateProvider !== undefined) {
    return options.activityStateProvider
  }

  if (activityStateProviderOverride !== null) {
    return activityStateProviderOverride
  }

  if (options.now === undefined && options.stateDir === undefined) {
    return getPostHogActivityCaptureState
  }

  return () => getPostHogActivityCaptureState(options.now ?? new Date())
}

function createPostHogClient(
  source: PostHogSource,
  options: CreatePostHogClientOptions = {},
): PostHogClient {
  const client = createTelemetryClient({
    diagnostics: writeTelemetryDiagnostic,
    env: options.env ?? process.env,
    osProvider: options.osProvider ?? resolveOsProvider(),
    product: createCodexTelemetryProductConfig(),
    source,
    transportFactory: options.transportFactory,
  })

  if (!client.enabled) {
    return NO_OP_POSTHOG
  }

  const activityStateProvider = resolveActivityStateProvider(options)

  return {
    trackActive: (distinctId, reason) => {
      const activityState = options.stateDir === undefined
        ? activityStateProvider()
        : getDailyActiveCaptureState({
            diagnostics: writeTelemetryDiagnostic,
            now: options.now,
            stateDir: options.stateDir,
          })
      if (!activityState.captureDaily) {
        return
      }

      client.trackActive({
        dayUTC: activityState.dayUTC,
        distinctId,
        reason,
      })
    },
    shutdown: async () => {
      await client.shutdown()
    },
  }
}

export function getPostHogDistinctId(): string {
  return getTelemetryDistinctId(MACHINE_ID_PREFIX, resolveOsProvider())
}

export function createCliPostHog(): PostHogClient {
  return createPostHogClient("cli")
}

export function createInstallPostHog(): PostHogClient {
  return createPostHogClient("install")
}

export function createPluginPostHog(): PostHogClient {
  return createPostHogClient("plugin")
}

export function __createPostHogForTesting(
  source: PostHogSource,
  options: CreatePostHogClientOptions,
): PostHogClient {
  return createPostHogClient(source, options)
}

export function __setOsProviderForTesting(provider: TelemetryOsProvider): void {
  osProviderOverride = provider
}

export function __resetOsProviderForTesting(): void {
  osProviderOverride = null
}

export function __setActivityStateProviderForTesting(provider: ActivityStateProvider): void {
  activityStateProviderOverride = provider
}

export function __resetActivityStateProviderForTesting(): void {
  activityStateProviderOverride = null
}
