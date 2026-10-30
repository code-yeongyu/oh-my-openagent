import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { writeFileAtomically } from "@oh-my-opencode/utils/atomic-write"
import { resolveXdgDataDir } from "@oh-my-opencode/utils/xdg-data-dir"
import type { XdgOsProvider } from "@oh-my-opencode/utils/xdg-data-dir"

import { claimUtcDay } from "./day-claim"
import type { TelemetryDiagnosticInput, TelemetryProductConfig } from "./types"

const POSTHOG_ACTIVITY_STATE_FILE = "posthog-activity.json"

// Bounds a process that cannot persist its stamp at all: without this it would ask again on every
// call, which is how a reload loop turns one machine into thousands of events a day.
const capturedDaysByStateDir = new Map<string, string>()

export type PostHogActivityState = {
  readonly lastActiveDayUTC?: string
}

export type PostHogActivityCaptureState = {
  readonly dayUTC: string
  readonly captureDaily: boolean
}

export type DailyActiveCaptureStateInput = {
  readonly stateDir: string
  readonly now?: Date
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
}

export type ResolveTelemetryStateDirOptions = {
  readonly env?: NodeJS.ProcessEnv
  readonly osProvider?: XdgOsProvider
}

export function resolveTelemetryStateDir(
  product: Pick<TelemetryProductConfig, "cacheDirName">,
  options: ResolveTelemetryStateDirOptions = {},
): string {
  const dataDir = resolveXdgDataDir(product.cacheDirName, {
    env: options.env,
    osProvider: options.osProvider,
  })
  const xdgStateDir =
    options.env?.XDG_DATA_HOME === undefined
      ? undefined
      : join(options.env.XDG_DATA_HOME, product.cacheDirName)

  if (
    dataDir === xdgStateDir ||
    (xdgStateDir === undefined && basename(dataDir) === product.cacheDirName)
  ) {
    return dataDir
  }

  return join(dataDir, product.cacheDirName)
}

export function getTelemetryActivityStateFilePath(stateDir: string): string {
  return join(stateDir, POSTHOG_ACTIVITY_STATE_FILE)
}

export function getDailyActiveCaptureState(
  input: DailyActiveCaptureStateInput,
): PostHogActivityCaptureState {
  const dayUTC = getUtcDayString(input.now ?? new Date())
  if (capturedDaysByStateDir.get(input.stateDir) === dayUTC) {
    return { dayUTC, captureDaily: false }
  }

  const state = readPostHogActivityState(input.stateDir, input.diagnostics)
  if (state.lastActiveDayUTC === dayUTC) {
    capturedDaysByStateDir.set(input.stateDir, dayUTC)
    return { dayUTC, captureDaily: false }
  }

  const claim = claimUtcDay(input.stateDir, dayUTC)
  capturedDaysByStateDir.set(input.stateDir, dayUTC)
  if (claim === "already-claimed") {
    return { dayUTC, captureDaily: false }
  }

  // The claim already carries the decision, so the state file is advisory: it keeps the fast path
  // read-only, repairs a corrupt file, and lets a client predating claims keep deduping.
  if (claim === "claimed") {
    writePostHogActivityState(input.stateDir, {
      ...state,
      lastActiveDayUTC: dayUTC,
    }, input.diagnostics)
  }

  return { dayUTC, captureDaily: true }
}

function getUtcDayString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function isPostHogActivityState(value: unknown): value is PostHogActivityState {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readPostHogActivityState(
  stateDir: string,
  diagnostics?: (input: TelemetryDiagnosticInput) => void,
): PostHogActivityState {
  const stateFilePath = getTelemetryActivityStateFilePath(stateDir)
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
    diagnostics?.({
      event: "telemetry_activity_state_read_failed",
      source: "shared",
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
    return {}
  }
}

function writePostHogActivityState(
  stateDir: string,
  nextState: PostHogActivityState,
  diagnostics?: (input: TelemetryDiagnosticInput) => void,
): void {
  const stateFilePath = getTelemetryActivityStateFilePath(stateDir)

  try {
    mkdirSync(stateDir, { recursive: true })
    writeFileAtomically(stateFilePath, `${JSON.stringify(nextState, null, 2)}\n`)
  } catch (error) {
    diagnostics?.({
      event: "telemetry_activity_state_write_failed",
      source: "shared",
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
  }
}
