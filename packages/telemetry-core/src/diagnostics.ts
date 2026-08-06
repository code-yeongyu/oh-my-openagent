import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { writeFileAtomically } from "@oh-my-opencode/utils/atomic-write"

import type { TelemetryDiagnosticErrorKind, TelemetryDiagnosticInput } from "./types"

const DIAGNOSTICS_FILE_NAME = "telemetry-diagnostics.jsonl"
const DIAGNOSTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DIAGNOSTICS_MAX_BYTES = 256 * 1024

export type WriteTelemetryDiagnosticOptions = {
  readonly diagnosticsDir: string
  readonly now?: Date
}

export function getTelemetryDiagnosticsFilePath(diagnosticsDir: string): string {
  return join(diagnosticsDir, DIAGNOSTICS_FILE_NAME)
}

export function writeTelemetryDiagnostic(
  input: TelemetryDiagnosticInput,
  options: WriteTelemetryDiagnosticOptions,
): void {
  const now = options.now ?? new Date()
  try {
    cleanupTelemetryDiagnostics({ diagnosticsDir: options.diagnosticsDir, now })
    mkdirSync(options.diagnosticsDir, { recursive: true })
    appendFileSync(
      getTelemetryDiagnosticsFilePath(options.diagnosticsDir),
      `${JSON.stringify(toDiagnosticRecord(input, now))}\n`,
      "utf-8",
    )
  } catch (error) {
    if (error instanceof Error) {
      return
    }
    return
  }
}

export function cleanupTelemetryDiagnostics(options: WriteTelemetryDiagnosticOptions): void {
  const diagnosticsFilePath = getTelemetryDiagnosticsFilePath(options.diagnosticsDir)
  if (!existsSync(diagnosticsFilePath)) {
    return
  }

  try {
    const cutoffMs = (options.now ?? new Date()).getTime() - DIAGNOSTICS_RETENTION_MS
    const retainedLines = trimToMaxBytes(
      readFileSync(diagnosticsFilePath, "utf-8")
        .split("\n")
        .filter((line) => shouldRetainLine(line, cutoffMs)),
    )
    writeFileAtomically(
      diagnosticsFilePath,
      retainedLines.length === 0 ? "" : `${retainedLines.join("\n")}\n`,
    )
  } catch (error) {
    if (error instanceof Error) {
      return
    }
    return
  }
}

function toDiagnosticRecord(input: TelemetryDiagnosticInput, now: Date): Record<string, string> {
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
  const timestamp = parsed?.["timestamp"]
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
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function trimToMaxBytes(lines: readonly string[]): readonly string[] {
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
