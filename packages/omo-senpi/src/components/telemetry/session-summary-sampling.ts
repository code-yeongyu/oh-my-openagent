import { createHash } from "node:crypto"

import type { TelemetryEnv } from "@oh-my-opencode/telemetry-core"

export const RAW_TURN_SAMPLE_RATE = 0.05
export const RAW_TURN_SAMPLE_RATE_ENV = "OMO_TELEMETRY_RAW_TURN_SAMPLE_RATE"

export type TelemetrySink = "posthog" | "collector"

export function isSessionSampled(sessionHash: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true
  if (sampleRate <= 0) return false
  const bucket = createHash("sha256").update(`turn-sample:${sessionHash}`).digest().readUInt32BE(0)
  return bucket / 0x1_0000_0000 < sampleRate
}

/**
 * Share of sessions that also send every raw `turn_completed`. The collector stores and samples
 * server-side, so its sink always gets every turn; on the direct PostHog path the env override wins over
 * `telemetry.rawTurnSampleRate`, which wins over the default. Values outside [0, 1] are ignored.
 */
export function resolveRawTurnSampleRate(input: {
  readonly sink: TelemetrySink
  readonly configured?: number
  readonly env: TelemetryEnv
}): number {
  if (input.sink === "collector") return 1
  return parseRate(input.env[RAW_TURN_SAMPLE_RATE_ENV]) ?? validRate(input.configured) ?? RAW_TURN_SAMPLE_RATE
}

function parseRate(value: string | undefined): number | undefined {
  const trimmed = value?.trim() ?? ""
  return trimmed.length === 0 ? undefined : validRate(Number(trimmed))
}

function validRate(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
}
