import {
  createDefaultPostHogTransport,
  createTelemetryClient,
  getDefaultTelemetryOsProvider,
  getTelemetryDistinctId,
} from "@oh-my-opencode/telemetry-core"
import type {
  PostHogActivityCaptureState,
  TelemetryDiagnosticInput,
  TelemetryEnv,
  TelemetryOsProvider,
  TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"
import { getPostHogActivityCaptureState } from "./posthog-activity-state"
import { log } from "./logger"
import { createOpencodeTelemetryProductConfig } from "./telemetry-product-identity"

/** @internal test-only seam: keep null in production to use the real implementation. */
let activityStateProviderOverride: typeof getPostHogActivityCaptureState | null = null
let osProviderOverride: TelemetryOsProvider | null = null
let transportFactoryOverride: TelemetryTransportFactory | null = null

function resolveActivityState(): PostHogActivityCaptureState {
  return (activityStateProviderOverride ?? getPostHogActivityCaptureState)()
}

function resolveOsProvider(): TelemetryOsProvider {
  return osProviderOverride ?? getDefaultTelemetryOsProvider()
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
export function __setOsProviderForTesting(provider: TelemetryOsProvider): void {
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

export type PostHogSource = "cli" | "plugin"
export type PostHogActivityReason = "run_started" | "plugin_loaded"

export type PostHogClient = {
  readonly trackActive: (distinctId: string, reason: PostHogActivityReason) => void
  readonly shutdown: () => Promise<void>
}

type CreatePostHogOptions = {
  readonly configEnabled?: boolean
}

type RecordPluginTelemetryInput = {
  readonly configEnabled?: boolean
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

export function shouldDisablePostHog(env: TelemetryEnv, configEnabled: boolean | undefined): boolean {
  if (configEnabled === false) {
    return true
  }

  if (isTruthy(env.OMO_DISABLE_POSTHOG?.trim().toLowerCase())) {
    return true
  }

  return isFalsy(env.OMO_SEND_ANONYMOUS_TELEMETRY?.trim().toLowerCase())
}

function createCoreCompatibleTelemetryEnv(env: NodeJS.ProcessEnv): TelemetryEnv {
  if (env.OMO_SEND_ANONYMOUS_TELEMETRY?.trim().toLowerCase() !== "yes") {
    return env
  }

  return {
    ...env,
    OMO_SEND_ANONYMOUS_TELEMETRY: "1",
  }
}

function logTelemetryDiagnostic(input: TelemetryDiagnosticInput): void {
  log("[posthog] telemetry diagnostic", {
    event: input.event,
    error: input.error === undefined ? undefined : String(input.error),
    errorKind: input.errorKind,
    source: input.source,
  })
}

function createPostHogClient(source: PostHogSource, options: CreatePostHogOptions = {}): PostHogClient {
  const env = process.env
  if (shouldDisablePostHog(env, options.configEnabled)) {
    return NO_OP_POSTHOG
  }

  const client = createTelemetryClient({
    diagnostics: logTelemetryDiagnostic,
    env: createCoreCompatibleTelemetryEnv(env),
    osProvider: resolveOsProvider(),
    product: createOpencodeTelemetryProductConfig(),
    source,
    transportFactory: resolveTransportFactory(),
  })

  if (!client.enabled) {
    return NO_OP_POSTHOG
  }

  return {
    trackActive: (distinctId, reason) => {
      const activityState = resolveActivityState()
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
  return getTelemetryDistinctId(createOpencodeTelemetryProductConfig().machineIdPrefix, resolveOsProvider())
}

export function createCliPostHog(options: CreatePostHogOptions = {}): PostHogClient {
  return createPostHogClient("cli", options)
}

export function createPluginPostHog(options: CreatePostHogOptions = {}): PostHogClient {
  return createPostHogClient("plugin", options)
}

export function recordPluginTelemetry(input: RecordPluginTelemetryInput): void {
  const posthog = createPluginPostHog({ configEnabled: input.configEnabled })
  const distinctId = getPostHogDistinctId()
  posthog.trackActive(distinctId, "plugin_loaded")
  void posthog.shutdown()
}
