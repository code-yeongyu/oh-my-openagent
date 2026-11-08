import type {
  EventTelemetryProperties,
  TelemetryOsProvider,
} from "@oh-my-opencode/telemetry-core"

import { CRASH_DETECTIONS, CRASH_SIGNALS, PROCESS_KINDS, UPTIME_BUCKETS } from "./crash-schema"
import type { ClaimedCrashRecord } from "./process-crash-records"

export type CaptureProcessCrashesInput = {
  readonly captureEvent: (name: "process_crashed", properties: EventTelemetryProperties) => void
  readonly agentDir: string
  readonly stateDir: string
  readonly now?: Date
  readonly osProvider: TelemetryOsProvider
}

/** Legacy automatic crash reporting is retired; usage telemetry is not crash consent. */
export function captureProcessCrashes(_input: CaptureProcessCrashesInput): number {
  return 0
}

export function processCrashedProperties(
  { record, source, shardKind }: ClaimedCrashRecord,
  osProvider: TelemetryOsProvider,
): EventTelemetryProperties {
  const kind = record.kind ?? (source === "rpc-host" ? "rpc-host" : "unknown")
  const detection = record.detection ?? (source === "rpc-host" ? "supervisor" : "unknown")
  return {
    process_kind: oneOf(PROCESS_KINDS, kind, "unknown"),
    shard_kind: shardKind,
    detection: oneOf(CRASH_DETECTIONS, detection, "unknown"),
    signal: signalName(record.signal, detection),
    ...(record.code === undefined ? {} : { exit_code: record.code }),
    uptime_ms: Math.round(record.uptimeMs),
    uptime_bucket: uptimeBucket(record.uptimeMs),
    crashed_bun_version: versionOrUnknown(record.bunVersion),
    crashed_engine_version: versionOrUnknown(record.engineVersion),
    crashed_omo_version: versionOrUnknown(record.productVersion),
    $os: osProvider.platform(),
    arch: osProvider.arch(),
  }
}

/** A dead marker proves the death but never saw the signal; any other absence is an exit code. */
function signalName(signal: string | undefined, detection: string): string {
  if (signal === undefined) return detection === "unclean_exit" ? "unknown" : "none"
  return oneOf(CRASH_SIGNALS, signal, "other")
}

function uptimeBucket(ms: number): (typeof UPTIME_BUCKETS)[number] {
  const minutes = ms / 60_000
  if (minutes < 1) return "lt_1m"
  if (minutes < 10) return "1_10m"
  if (minutes < 60) return "10_60m"
  if (minutes < 360) return "1_6h"
  if (minutes < 1440) return "6_24h"
  return "24h_plus"
}

/** Only version-shaped strings leave the machine; anything else (paths, junk) becomes `unknown`. */
function versionOrUnknown(value: string | undefined): string {
  return value !== undefined && /^[0-9][0-9A-Za-z.+-]{0,31}$/.test(value) ? value : "unknown"
}

function oneOf<const Values extends readonly string[]>(values: Values, value: string, fallback: Values[number]): Values[number] {
  return values.includes(value) ? value : fallback
}
