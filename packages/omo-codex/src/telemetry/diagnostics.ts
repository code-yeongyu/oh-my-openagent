import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { writeFileAtomically } from "./atomic-write"
import { getActivityStateDir } from "./data-path"

export type TelemetryDiagnosticEvent =
  | "telemetry_activity_state_read_failed"
  | "telemetry_activity_state_write_failed"
  | "telemetry_capture_failed"
  | "telemetry_cpu_info_unavailable"
  | "telemetry_posthog_import_failed"
  | "telemetry_posthog_init_failed"
  | "telemetry_shutdown_failed"

export type TelemetryDiagnosticSource = "cli" | "install" | "plugin" | "shared"

export type TelemetryDiagnosticErrorKind = "error" | "non_error"

export type TelemetryDiagnosticInput = {
  readonly event: TelemetryDiagnosticEvent
  readonly source: TelemetryDiagnosticSource
  readonly error?: unknown
  readonly errorKind?: TelemetryDiagnosticErrorKind
}

const DIAGNOSTICS_FILE_NAME = "telemetry-diagnostics.jsonl"
const DIAGNOSTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DIAGNOSTICS_MAX_BYTES = 256 * 1024

export function getTelemetryDiagnosticsFilePath(): string {
  return join(getActivityStateDir(), DIAGNOSTICS_FILE_NAME)
}

export function writeTelemetryDiagnostic(input: TelemetryDiagnosticInput, now: Date = new Date()): void {
  try {
    cleanupTelemetryDiagnostics(now)
    mkdirSync(getActivityStateDir(), { recursive: true })
    appendFileSync(getTelemetryDiagnosticsFilePath(), `${JSON.stringify(toDiagnosticRecord(input, now))}\n`, "utf-8")
  } catch {
    return
  }
}

export function cleanupTelemetryDiagnostics(now: Date = new Date()): void {
  const diagnosticsFilePath = getTelemetryDiagnosticsFilePath()
  if (!existsSync(diagnosticsFilePath)) {
    return
  }

  try {
    const cutoffMs = now.getTime() - DIAGNOSTICS_RETENTION_MS
    const retainedLines = trimToMaxBytes(
      readFileSync(diagnosticsFilePath, "utf-8")
        .split("\n")
        .filter((line) => shouldRetainLine(line, cutoffMs)),
    )
    writeFileAtomically(diagnosticsFilePath, retainedLines.length === 0 ? "" : `${retainedLines.join("\n")}\n`)
  } catch {
    return
  }
}

function toDiagnosticRecord(
  input: TelemetryDiagnosticInput,
  now: Date,
): Record<string, string> {
  return {
    timestamp: now.toISOString(),
    event: input.event,
    source: input.source,
    ...serializeError(input.error, input.errorKind),
  }
}

function serializeError(
  error: unknown,
  errorKind?: TelemetryDiagnosticErrorKind,
): Record<string, string> {
  if (error instanceof Error) {
    return {
      error_kind: errorKind ?? "error",
      error_name: error.name,
      error_message: error.message,
    }
  }

  if (error === undefined) {
    return {}
  }

  return {
    error_kind: errorKind ?? "non_error",
    error_name: typeof error,
    error_message: String(error),
  }
}

function shouldRetainLine(line: string, cutoffMs: number): boolean {
  if (line.length === 0) {
    return false
  }

  const parsed = parseDiagnosticLine(line)
  if (parsed === null) {
    return false
  }

  const timestamp = parsed["timestamp"]
  if (typeof timestamp !== "string") {
    return false
  }

  const timestampMs = Date.parse(timestamp)
  return Number.isFinite(timestampMs) && timestampMs >= cutoffMs
}

function parseDiagnosticLine(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (!isRecord(parsed)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function trimToMaxBytes(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  const retained: string[] = []
  let totalBytes = 0

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined) {
      continue
    }

    const lineBytes = Buffer.byteLength(`${line}\n`, "utf-8")
    if (totalBytes + lineBytes > DIAGNOSTICS_MAX_BYTES) {
      break
    }

    retained.unshift(line)
    totalBytes += lineBytes
  }

  return retained
}
