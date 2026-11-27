import type { HrTime, TimeInput } from "@opentelemetry/api"

export const OTEL_SDK_NAME = "omo-otel-minimal"
export const OTEL_SDK_VERSION = "1.0.0"
export const OTEL_SDK_LANGUAGE = "nodejs"
export const MAX_ATTRIBUTES = 128

export type InstrumentationScope = {
  readonly name: string
  readonly version: string
}

export type UnixNanos = bigint

export type OtelClock = () => UnixNanos

export const systemClock: OtelClock = () =>
  BigInt(Math.round((performance.timeOrigin + performance.now()) * 1_000)) * 1_000n

export function toUnixNanos(input: TimeInput | undefined, clock: OtelClock): UnixNanos {
  if (input === undefined) return clock()
  if (input instanceof Date) return BigInt(input.getTime()) * 1_000_000n
  if (typeof input === "number") return BigInt(Math.round(input * 1_000)) * 1_000n
  const [seconds, nanos] = input as HrTime
  return BigInt(seconds) * 1_000_000_000n + BigInt(nanos)
}
