import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { OmoSenpiComponent } from "../../extension/types"
import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  recordDailyActive,
  type RecordDailyActiveInput,
  TelemetryEnv,
  TelemetryOsProvider,
  TelemetryProductConfig,
  TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"
import type { ComponentLogger } from "../../extension/types"

export const SENPI_TELEMETRY_EVENT_NAME = "omo_senpi_daily_active"
export const SENPI_MACHINE_ID_PREFIX = "omo-senpi:"

const SENPI_AGENT_DIR_ENV = "SENPI_CODING_AGENT_DIR"
const SENPI_TELEMETRY_SOURCE = "senpi-extension"
const SESSION_START_REASON = "session_start"
const DEFAULT_TIMEOUT_MS = 500
const PACKAGE_VERSION = readPackageVersion()

export type SenpiTelemetryOptions = {
  readonly env?: TelemetryEnv
  readonly now?: Date
  readonly osProvider?: TelemetryOsProvider
  readonly stateDir?: string
  readonly timeoutMs?: number
  readonly transportFactory?: TelemetryTransportFactory
}

export function createSenpiTelemetryProductConfig(): TelemetryProductConfig {
  return {
    cacheDirName: "omo-senpi",
    defaultApiKey: DEFAULT_POSTHOG_API_KEY,
    defaultHost: DEFAULT_POSTHOG_HOST,
    eventName: SENPI_TELEMETRY_EVENT_NAME,
    machineIdPrefix: SENPI_MACHINE_ID_PREFIX,
    packageName: "@oh-my-opencode/omo-senpi",
    packageVersion: PACKAGE_VERSION,
    platform: "omo-senpi",
    productEnvPrefix: "OMO_SENPI",
    productName: "omo-senpi",
  }
}

export function getSenpiTelemetryStateDir(env: TelemetryEnv = process.env): string {
  return join(getSenpiAgentDir(env), "omo-senpi", "posthog")
}

export async function recordSenpiDailyActive(options: SenpiTelemetryOptions = {}): Promise<void> {
  const input = createRecordDailyActiveInput(options)
  await withTimeout(
    recordDailyActive(
      options.transportFactory === undefined
        ? input
        : {
            ...input,
            transportFactory: options.transportFactory,
          },
    ),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
}

export function createSenpiTelemetryComponent(options: SenpiTelemetryOptions = {}): OmoSenpiComponent {
  return {
    name: "telemetry",
    register(pi, ctx) {
      pi.on("session_start", () => {
        void recordSenpiDailyActive(options).catch((error: unknown) => {
          logDebug(ctx.logger, "omo-senpi telemetry failed", error)
        })
      })
    },
  }
}

export const omoSenpiTelemetryComponent = createSenpiTelemetryComponent()

function createRecordDailyActiveInput(options: SenpiTelemetryOptions): RecordDailyActiveInput {
  const env = options.env ?? process.env
  const baseInput = {
    env,
    product: createSenpiTelemetryProductConfig(),
    reason: SESSION_START_REASON,
    source: SENPI_TELEMETRY_SOURCE,
    stateDir: options.stateDir ?? getSenpiTelemetryStateDir(env),
  }

  return {
    ...baseInput,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.osProvider === undefined ? {} : { osProvider: options.osProvider }),
  }
}

function getSenpiAgentDir(env: TelemetryEnv): string {
  return env[SENPI_AGENT_DIR_ENV]?.trim() || join(homedir(), ".senpi", "agent")
}

function withTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, timeoutMs)
    operation.then(
      () => {
        clearTimeout(timeout)
        resolve()
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function readPackageVersion(): string {
  try {
    const manifestText = readFileSync(new URL("../../../package.json", import.meta.url), "utf-8")
    const parsed: unknown = JSON.parse(manifestText)
    if (isPackageManifest(parsed) && typeof parsed.version === "string") {
      return parsed.version
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      return "0.0.0"
    }
    return "0.0.0"
  }
  return "0.0.0"
}

function isPackageManifest(value: unknown): value is { readonly version?: string } {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function logDebug(logger: ComponentLogger, message: string, details: unknown): void {
  const debug = Reflect.get(logger, "debug")
  if (typeof debug === "function") {
    Reflect.apply(debug, logger, [message, details])
  }
}
