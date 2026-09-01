import {
  cleanupTelemetryDiagnostics as cleanupCoreTelemetryDiagnostics,
  getTelemetryDiagnosticsFilePath as getCoreTelemetryDiagnosticsFilePath,
  writeTelemetryDiagnostic as writeCoreTelemetryDiagnostic,
} from "@oh-my-opencode/telemetry-core"
import type {
  TelemetryDiagnosticErrorKind,
  TelemetryDiagnosticEvent,
  TelemetryDiagnosticInput,
} from "@oh-my-opencode/telemetry-core"

import { getActivityStateDir } from "./data-path"

export type {
  TelemetryDiagnosticErrorKind,
  TelemetryDiagnosticEvent,
  TelemetryDiagnosticInput,
}

export type TelemetryDiagnosticSource = "cli" | "install" | "plugin" | "shared"

export function getTelemetryDiagnosticsFilePath(): string {
  return getCoreTelemetryDiagnosticsFilePath(getActivityStateDir())
}

export function writeTelemetryDiagnostic(input: TelemetryDiagnosticInput, now: Date = new Date()): void {
  writeCoreTelemetryDiagnostic(input, {
    diagnosticsDir: getActivityStateDir(),
    now,
  })
}

export function cleanupTelemetryDiagnostics(now: Date = new Date()): void {
  cleanupCoreTelemetryDiagnostics({
    diagnosticsDir: getActivityStateDir(),
    now,
  })
}
