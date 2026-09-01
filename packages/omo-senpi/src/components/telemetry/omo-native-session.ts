import {
  createEventTelemetryClient,
  getDailyActiveCaptureState,
  getDefaultTelemetryOsProvider,
  getTelemetryDistinctId,
  isTelemetryClientEnabled,
  type EventTelemetryClient,
  type EventTelemetrySetTimeout,
  type TelemetryDiagnosticInput,
  type TelemetryEnv,
  type TelemetryOsProvider,
  type TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"
import { isOmoTelemetryEnabled, type OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { OmoSenpiComponent } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { getSenpiTelemetryStateDir, recordSenpiDailyActive } from "./index"
import { createCategoryConfigCapture } from "./omo-native-category-config"
import {
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
  OMO_NATIVE_SCHEMA_VERSION,
  createOmoNativeProductConfig,
  getOmoNativeStateDir,
  hashSessionId,
  withOmoNativeAttribution,
} from "./product-identity"
import { readOmoNativeInventory, type OmoNativeInventoryDiagnostic } from "./session-inventory"
import { resolveSessionModelRegistry } from "./session-model-registry"

export type { OmoNativeInventoryDiagnostic }

const SOURCE = "omo-native-session"
const SESSION_REASONS = new Set(["startup", "reload", "new", "resume", "fork"])

export type OmoNativeSessionOptions = {
  readonly diagnostics?: (input: TelemetryDiagnosticInput | OmoNativeInventoryDiagnostic) => void
  readonly env?: TelemetryEnv
  readonly hashSessionId?: (rawId: string) => string
  readonly isConfigEnabled?: (cwd: string | undefined, env: TelemetryEnv) => boolean
  readonly now?: Date
  readonly osProvider?: TelemetryOsProvider
  readonly setTimeoutFn?: EventTelemetrySetTimeout
  /** Device-reported IANA zone. Injected in tests; the host default reads the runtime's resolved zone. */
  readonly timeZone?: () => string
  readonly transportFactory?: TelemetryTransportFactory
}

export function createOmoNativeSessionComponent(options: OmoNativeSessionOptions = {}): OmoSenpiComponent {
  let client: EventTelemetryClient | undefined

  return {
    name: "omo-native-session",
    register(pi, ctx) {
      pi.on("session_start", (payload, eventCtx) => {
        const env = options.env ?? process.env
        const product = createOmoNativeProductConfig()
        if (!isTelemetryClientEnabled({ env, product }) || !configEnabled(options, eventCtx, env)) return

        const osProvider = options.osProvider ?? getDefaultTelemetryOsProvider()
        const sessionId = extractSessionId(eventCtx) ?? "unknown"
        client = createEventTelemetryClient({
          diagnostics: options.diagnostics,
          distinctId: getTelemetryDistinctId(product.machineIdPrefix, osProvider),
          env,
          product: withOmoNativeAttribution(product, { env }),
          propertyAllowlist: OMO_NATIVE_PROPERTY_ALLOWLISTS,
          schemaVersion: OMO_NATIVE_SCHEMA_VERSION,
          setTimeoutFn: options.setTimeoutFn,
          source: SOURCE,
          transportFactory: options.transportFactory,
        })
        if (!client.enabled) return

        const sessionHash = (options.hashSessionId ?? hashSessionId)(sessionId)
        const activity = getDailyActiveCaptureState({
          diagnostics: options.diagnostics,
          now: options.now,
          stateDir: getOmoNativeStateDir(env),
        })
        if (activity.captureDaily) {
          client.captureEvent("daily_active", {
            $session_id: sessionHash,
            day_utc: activity.dayUTC,
            reason: "session_start",
          })
        }

        const inventory = readOmoNativeInventory(resolveAgentHome({ env }), options.diagnostics)
        const reason = sessionReason(payload)
        const timezone = readTimeZone(options.timeZone)
        client.captureEvent("session_started", {
          $session_id: sessionHash,
          $os: osProvider.platform(),
          $os_version: osProvider.release(),
          arch: osProvider.arch(),
          cpu_count: osProvider.cpus().length,
          memory_bucket: memoryBucket(osProvider.totalmem()),
          provider_count: inventory.providerCount,
          model_count: inventory.modelCount,
          providers: inventory.providers,
          reason,
          ...(timezone === undefined ? {} : { timezone }),
          ...(inventory.defaultProvider === undefined ? {} : { default_provider: inventory.defaultProvider }),
          ...(inventory.defaultModel === undefined ? {} : { default_model: inventory.defaultModel }),
        })

        // The category map is only observable where BOTH the config and the live model registry are
        // in hand. A host that reports no registry (older host, RPC context) simply ships no snapshot
        // rather than a snapshot that guesses availability.
        captureCategoryConfig({
          client,
          eventCtx,
          omoConfig: loadCategoryConfig(options, eventCtx, env),
          reason,
          sessionHash,
        })

        void recordSenpiDailyActive({
          env,
          now: options.now,
          osProvider,
          stateDir: getSenpiTelemetryStateDir(env),
          transportFactory: options.transportFactory,
        }).catch((error: unknown) => {
          ctx.logger.warn("omo-senpi legacy telemetry failed", error)
        })
      })

      pi.on("session_shutdown", async () => {
        const activeClient = client
        client = undefined
        await activeClient?.shutdown()
      })
    },
  }
}

// Fire-and-forget: an unreadable config or a throwing registry costs the snapshot, never the session.
function captureCategoryConfig(input: {
  readonly client: EventTelemetryClient
  readonly eventCtx: unknown
  readonly omoConfig: OmoConfig | undefined
  readonly reason: string
  readonly sessionHash: string
}): void {
  const registry = resolveSessionModelRegistry(input.eventCtx)
  if (registry === undefined || input.omoConfig === undefined) return
  createCategoryConfigCapture({
    captureEvent: input.client.captureEvent,
    omoConfig: input.omoConfig,
    sessionHash: input.sessionHash,
  }).observe({ registry, source: input.reason })
}

function loadCategoryConfig(
  options: OmoNativeSessionOptions,
  eventCtx: unknown,
  env: TelemetryEnv,
): OmoConfig | undefined {
  const cwd = extractString(eventCtx, "cwd")
  try {
    return loadSenpiOmoConfig({ env: { ...env }, ...(cwd === undefined ? {} : { cwd }) }).config
  } catch (error) {
    options.diagnostics?.({
      event: "telemetry_capture_failed",
      source: SOURCE,
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
    return undefined
  }
}

// A runtime without ICU data (or a host that refuses the lookup) simply ships no timezone.
function readTimeZone(provider: (() => string) | undefined): string | undefined {
  try {
    const zone = (provider ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone))()
    return zone.length > 0 && zone.length <= 64 ? zone : undefined
  } catch {
    return undefined
  }
}

function configEnabled(options: OmoNativeSessionOptions, eventCtx: unknown, env: TelemetryEnv): boolean {
  const cwd = extractString(eventCtx, "cwd")
  if (options.isConfigEnabled !== undefined) return options.isConfigEnabled(cwd, env)
  try {
    const loaded = loadSenpiOmoConfig({
      env: { ...env },
      ...(cwd === undefined ? {} : { cwd }),
    })
    if (loaded.diagnostics.length === 0) return isOmoTelemetryEnabled(loaded.config)
    const error = new Error(loaded.diagnostics.map(({ message }) => message).join("; "))
    options.diagnostics?.({ event: "telemetry_capture_failed", source: SOURCE, error, errorKind: "error" })
    return false
  } catch (error) {
    options.diagnostics?.({
      event: "telemetry_capture_failed",
      source: SOURCE,
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function sessionReason(payload: unknown): string {
  const reason = extractString(payload, "reason")
  return reason !== undefined && SESSION_REASONS.has(reason) ? reason : "startup"
}

function extractSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const manager = Reflect.get(value, "sessionManager")
  if (!isRecord(manager)) return undefined
  const getSessionId = Reflect.get(manager, "getSessionId")
  if (typeof getSessionId !== "function") return undefined
  const sessionId: unknown = Reflect.apply(getSessionId, manager, [])
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}

function extractString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const property = Reflect.get(value, key)
  return typeof property === "string" && property.length > 0 ? property : undefined
}

function memoryBucket(bytes: number): string {
  const gib = bytes / 1024 / 1024 / 1024
  if (gib < 8) return "lt_8_gb"
  if (gib < 16) return "8_15_gb"
  if (gib < 32) return "16_31_gb"
  if (gib < 64) return "32_63_gb"
  return "64_plus_gb"
}
