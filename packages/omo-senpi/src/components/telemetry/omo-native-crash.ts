import type {
  EventTelemetryProperties,
  TelemetryDiagnosticInput,
  TelemetryOsProvider,
} from "@oh-my-opencode/telemetry-core"

import { CRASH_DETECTIONS, CRASH_SIGNALS, PROCESS_KINDS, UPTIME_BUCKETS } from "./crash-schema"
import { claimUnreportedCrashRecords, type ClaimedCrashRecord } from "./process-crash-records"

export type CaptureProcessCrashesInput = {
  readonly captureEvent: (name: "process_crashed", properties: EventTelemetryProperties) => void
  readonly agentDir: string
  readonly stateDir: string
  readonly now?: Date
  readonly osProvider: TelemetryOsProvider
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
}

/**
 * Report every crash an earlier OmO process left on disk, once. Called only after the telemetry
 * gates passed, so an opted-out user neither sends nor claims anything. Returns how many were sent.
 */
export function captureProcessCrashes(input: CaptureProcessCrashesInput): number {
  try {
    const claimed = claimUnreportedCrashRecords({
      agentDir: input.agentDir,
      stateDir: input.stateDir,
      now: input.now ?? new Date(),
    })
    for (const crash of claimed) input.captureEvent("process_crashed", processCrashedProperties(crash, input.osProvider))
    return claimed.length
  } catch (error) {
    input.diagnostics?.({
      event: "telemetry_capture_failed",
      source: "omo-native-crash",
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
    return 0
  }
}

export function processCrashedProperties(
  { record, source }: ClaimedCrashRecord,
  osProvider: TelemetryOsProvider,
): EventTelemetryProperties {
  const kind = record.kind ?? (source === "rpc-host" ? "rpc-host" : "unknown")
  const detection = record.detection ?? (source === "rpc-host" ? "supervisor" : "unknown")
  return {
    process_kind: oneOf(PROCESS_KINDS, kind, "unknown"),
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
