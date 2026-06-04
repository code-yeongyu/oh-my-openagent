import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { writeFileAtomically } from "./atomic-write"
import { getActivityStateDir } from "./data-path"
import { type TelemetryDiagnosticErrorKind, type TelemetryDiagnosticEvent, writeTelemetryDiagnostic } from "./diagnostics"

export type PostHogActivityState = {
  readonly lastActiveDayUTC?: string
}

export type PostHogActivityCaptureState = {
  readonly dayUTC: string
  readonly captureDaily: boolean
}

const POSTHOG_ACTIVITY_STATE_FILE = "posthog-activity.json"

function getPostHogActivityStateFilePath(): string {
  return join(getActivityStateDir(), POSTHOG_ACTIVITY_STATE_FILE)
}

function getUtcDayString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function isPostHogActivityState(value: unknown): value is PostHogActivityState {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function writeActivityStateDiagnostic(
  event: TelemetryDiagnosticEvent,
  error: unknown,
  errorKind: TelemetryDiagnosticErrorKind,
): void {
  writeTelemetryDiagnostic({
    event,
    source: "shared",
    error,
    errorKind,
  })
}

function readPostHogActivityState(): PostHogActivityState {
  const stateFilePath = getPostHogActivityStateFilePath()

  if (!existsSync(stateFilePath)) {
    return {}
  }

  try {
    const stateContent = readFileSync(stateFilePath, "utf-8")
    const stateJson: unknown = JSON.parse(stateContent)

    if (!isPostHogActivityState(stateJson)) {
      return {}
    }

    return stateJson
  } catch (error) {
    writeActivityStateDiagnostic("telemetry_activity_state_read_failed", error, error instanceof Error ? "error" : "non_error")
    return {}
  }
}

function writePostHogActivityState(nextState: PostHogActivityState): void {
  const stateDir = getActivityStateDir()
  const stateFilePath = getPostHogActivityStateFilePath()

  try {
    mkdirSync(stateDir, { recursive: true })
    writeFileAtomically(stateFilePath, `${JSON.stringify(nextState, null, 2)}\n`)
  } catch (error) {
    writeActivityStateDiagnostic("telemetry_activity_state_write_failed", error, error instanceof Error ? "error" : "non_error")
    return
  }
}

export function getPostHogActivityCaptureState(
  now: Date = new Date(),
): PostHogActivityCaptureState {
  const state = readPostHogActivityState()
  const dayUTC = getUtcDayString(now)
  const captureDaily = state.lastActiveDayUTC !== dayUTC

  if (captureDaily) {
    writePostHogActivityState({
      ...state,
      lastActiveDayUTC: dayUTC,
    })
  }

  return {
    dayUTC,
    captureDaily,
  }
}
