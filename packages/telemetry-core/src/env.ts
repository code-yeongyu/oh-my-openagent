import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  UNCONFIGURED_POSTHOG_API_KEY,
} from "./constants"
import type { TelemetryEnv } from "./types"

const TRUTHY_DISABLE_VALUES = ["1", "true", "yes"] as const
const SEND_OPT_OUT_VALUES = ["0", "false", "no", "yes"] as const

export type ShouldDisableTelemetryInput = {
  readonly env?: TelemetryEnv
  readonly globalEnvPrefix?: string
  readonly productEnvPrefix: string
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase()
}

function includesValue(values: readonly string[], value: string | undefined): boolean {
  const normalized = normalizeEnvValue(value)
  return normalized !== undefined && values.includes(normalized)
}

function isDisableFlag(value: string | undefined): boolean {
  return includesValue(TRUTHY_DISABLE_VALUES, value)
}

function isSendOptOutFlag(value: string | undefined): boolean {
  return includesValue(SEND_OPT_OUT_VALUES, value)
}

export function shouldDisableTelemetry(input: ShouldDisableTelemetryInput): boolean {
  const env = input.env ?? process.env
  const globalPrefix = input.globalEnvPrefix ?? "OMO"
  const prefixes = Array.from(new Set([globalPrefix, input.productEnvPrefix]))

  if (isDisableFlag(env["DO_NOT_TRACK"])) {
    return true
  }

  for (const prefix of prefixes) {
    if (isDisableFlag(env[`${prefix}_DISABLE_POSTHOG`])) {
      return true
    }

    if (isSendOptOutFlag(env[`${prefix}_SEND_ANONYMOUS_TELEMETRY`])) {
      return true
    }
  }

  return false
}

export function getTelemetryApiKey(
  env: TelemetryEnv = process.env,
  defaultApiKey: string = DEFAULT_POSTHOG_API_KEY,
): string {
  return env["POSTHOG_API_KEY"]?.trim() ?? defaultApiKey
}

export function isConfiguredTelemetryApiKey(apiKey: string): boolean {
  const normalized = apiKey.trim()
  return normalized.length > 0 && normalized !== UNCONFIGURED_POSTHOG_API_KEY
}

export function hasTelemetryApiKey(env?: TelemetryEnv, defaultApiKey?: string): boolean {
  return isConfiguredTelemetryApiKey(getTelemetryApiKey(env, defaultApiKey))
}

export function getTelemetryHost(
  env: TelemetryEnv = process.env,
  defaultHost: string = DEFAULT_POSTHOG_HOST,
): string {
  return env["POSTHOG_HOST"]?.trim() || defaultHost
}
