import { readFileSync } from "node:fs"
import { join } from "node:path"
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
import { isOmoTelemetryEnabled } from "@oh-my-opencode/omo-config-core"

import type { OmoSenpiComponent } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { getSenpiTelemetryStateDir, recordSenpiDailyActive } from "./index"
import {
  KNOWN_PROVIDERS,
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
  createOmoNativeProductConfig,
  getOmoNativeStateDir,
  hashSessionId,
  maskProviderAndModel,
} from "./product-identity"

const SOURCE = "omo-native-session"
const SESSION_REASONS = new Set(["startup", "reload", "new", "resume", "fork"])

export type OmoNativeInventoryDiagnostic = {
  readonly event: "omo_native_inventory_read_failed"
  readonly error: unknown
  readonly source: typeof SOURCE
}

export type OmoNativeSessionOptions = {
  readonly diagnostics?: (input: TelemetryDiagnosticInput | OmoNativeInventoryDiagnostic) => void
  readonly env?: TelemetryEnv
  readonly hashSessionId?: (rawId: string) => string
  readonly isConfigEnabled?: (cwd: string | undefined, env: TelemetryEnv) => boolean
  readonly now?: Date
  readonly osProvider?: TelemetryOsProvider
  readonly setTimeoutFn?: EventTelemetrySetTimeout
  readonly transportFactory?: TelemetryTransportFactory
}

type Inventory = {
  readonly defaultModel?: string
  readonly defaultProvider?: string
  readonly modelCount: number
  readonly providerCount: number
  readonly providers: string
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
          product,
          propertyAllowlist: OMO_NATIVE_PROPERTY_ALLOWLISTS,
          schemaVersion: 1,
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

        const inventory = readInventory(resolveAgentHome({ env }), options.diagnostics)
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
          reason: sessionReason(payload),
          ...(inventory.defaultProvider === undefined ? {} : { default_provider: inventory.defaultProvider }),
          ...(inventory.defaultModel === undefined ? {} : { default_model: inventory.defaultModel }),
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

function readInventory(
  agentDir: string,
  diagnostics?: OmoNativeSessionOptions["diagnostics"],
): Inventory {
  try {
    const models = readObject(join(agentDir, "models.json"))
    const settings = readObject(join(agentDir, "settings.json"))
    const providers = Reflect.get(models, "providers")
    if (!isRecord(providers)) throw new Error("models.json providers must be an object")

    let modelCount = 0
    for (const provider of Object.values(providers)) {
      if (!isRecord(provider)) throw new Error("models.json provider must be an object")
      const modelsValue = Reflect.get(provider, "models")
      if (modelsValue !== undefined && !Array.isArray(modelsValue)) {
        throw new Error("models.json provider models must be an array")
      }
      modelCount += modelsValue?.length ?? 0
    }

    const providerIds = Object.keys(providers)
    const defaultProvider = stringProperty(settings, "defaultProvider")
    const defaultModel = stringProperty(settings, "defaultModel")
    const masked = defaultProvider !== undefined && defaultModel !== undefined
      ? maskProviderAndModel(defaultProvider, defaultModel)
      : undefined
    return {
      providerCount: providerIds.length,
      modelCount,
      providers: providerIds.filter((id) => isKnownProvider(id)).sort().join(","),
      ...(masked === undefined ? {} : {
        defaultProvider: masked.provider,
        defaultModel: masked.model_id,
      }),
    }
  } catch (error) {
    diagnostics?.({ event: "omo_native_inventory_read_failed", error, source: SOURCE })
    return { providerCount: 0, modelCount: 0, providers: "" }
  }
}

function readObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isRecord(parsed)) throw new Error(`${path} must contain an object`)
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isKnownProvider(value: string): boolean {
  return KNOWN_PROVIDERS.some((provider) => provider === value)
}

function stringProperty(value: Record<string, unknown>, key: string): string | undefined {
  const property = Reflect.get(value, key)
  return typeof property === "string" && property.length > 0 ? property : undefined
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
