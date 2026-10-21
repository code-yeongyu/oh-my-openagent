import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  UNCONFIGURED_POSTHOG_API_KEY,
} from "./constants"
import type { TelemetryEnv } from "./types"

const TRUTHY_DISABLE_VALUES = ["1", "true", "yes"] as const
// `yes` is deliberately absent: this variable has always treated `yes` as an opt-out (the
// "approved codex send yes convergence" row in env.test.ts), so only `1` and `true` force telemetry
// on. Widening this list would silently un-opt-out every machine that already answered `yes`.
const TRUTHY_OPT_IN_VALUES = ["1", "true"] as const
const SEND_OPT_OUT_VALUES = ["0", "false", "no", "yes"] as const

export type TelemetryEnvDecision = "disable" | "opt_in" | "unset"

export type ShouldDisableTelemetryInput = {
  readonly env?: TelemetryEnv
  readonly globalEnvPrefix?: string
  readonly productEnvPrefix: string
  /**
   * The machine's recorded answer. Undefined means unanswered, which resolves to disabled, so a
   * caller that never asks the user still fails closed.
   */
  readonly consentEnabled?: boolean
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

function isOptInFlag(value: string | undefined): boolean {
  return includesValue(TRUTHY_OPT_IN_VALUES, value)
}

function isSendOptOutFlag(value: string | undefined): boolean {
  return includesValue(SEND_OPT_OUT_VALUES, value)
}

/**
 * What the environment alone says. `disable` beats `opt_in` inside one environment, so a shell that
 * exports both fails closed rather than racing two flags against each other.
 */
export function resolveTelemetryEnvDecision(input: ShouldDisableTelemetryInput): TelemetryEnvDecision {
  const env = input.env ?? process.env
  const globalPrefix = input.globalEnvPrefix ?? "OMO"
  const prefixes = Array.from(new Set([globalPrefix, input.productEnvPrefix]))

  if (isDisableFlag(env["DO_NOT_TRACK"]) || isDisableFlag(env[`${globalPrefix}_DISABLE_TELEMETRY`])) {
    return "disable"
  }

  for (const prefix of prefixes) {
    if (isDisableFlag(env[`${prefix}_DISABLE_POSTHOG`])) return "disable"
    if (isSendOptOutFlag(env[`${prefix}_SEND_ANONYMOUS_TELEMETRY`])) return "disable"
  }

  for (const prefix of prefixes) {
    if (isOptInFlag(env[`${prefix}_SEND_ANONYMOUS_TELEMETRY`])) return "opt_in"
  }

  return "unset"
}

/**
 * Telemetry is opt-in. An environment that says nothing and a machine that has not answered both
 * resolve to disabled; only a recorded yes, or a force-on flag, enables anything.
 */
export function shouldDisableTelemetry(input: ShouldDisableTelemetryInput): boolean {
  const decision = resolveTelemetryEnvDecision(input)
  if (decision === "disable") return true
  if (decision === "opt_in") return false
  return input.consentEnabled !== true
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
