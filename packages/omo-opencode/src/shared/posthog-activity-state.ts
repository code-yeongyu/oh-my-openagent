import {
  getDailyActiveCaptureState,
  getTelemetryActivityStateFilePath,
  resolveTelemetryStateDir,
} from "@oh-my-opencode/telemetry-core"
import type { TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import { log } from "./logger"
import { CACHE_DIR_NAME } from "./plugin-identity"

type PostHogActivityCaptureState = {
  dayUTC: string
  captureDaily: boolean
}

function getPostHogActivityStateDir(): string {
  return resolveTelemetryStateDir({ cacheDirName: CACHE_DIR_NAME })
}

function logActivityStateDiagnostic(input: TelemetryDiagnosticInput): void {
  const stateFilePath = getTelemetryActivityStateFilePath(getPostHogActivityStateDir())

  if (input.event === "telemetry_activity_state_read_failed") {
    log("[posthog-activity-state] Failed to read activity state", {
      error: String(input.error),
      stateFilePath,
    })
    return
  }

  if (input.event === "telemetry_activity_state_write_failed") {
    log("[posthog-activity-state] Failed to write activity state", {
      error: String(input.error),
      stateFilePath,
    })
  }
}

export function getPostHogActivityCaptureState(now: Date = new Date()): PostHogActivityCaptureState {
  return getDailyActiveCaptureState({
    diagnostics: logActivityStateDiagnostic,
    now,
    stateDir: getPostHogActivityStateDir(),
  })
}
