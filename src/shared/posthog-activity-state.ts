import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { getDataDir } from "./data-path"
import { log } from "./logger"
import { CACHE_DIR_NAME } from "./plugin-identity"
import { writeFileAtomically } from "./write-file-atomically"

type PostHogActivityState = {
  lastActiveDayUTC?: string
  lastActiveHourUTC?: string
}

type PostHogActivityCaptureState = {
  dayUTC: string
  hourUTC: string
  captureDaily: boolean
  captureHourly: boolean
}

const POSTHOG_ACTIVITY_STATE_FILE = "posthog-activity.json"

function getPostHogActivityStateFilePath(): string {
  return join(getDataDir(), CACHE_DIR_NAME, POSTHOG_ACTIVITY_STATE_FILE)
}

function getUtcDayString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getUtcHourString(date: Date): string {
  return date.toISOString().slice(0, 13)
}

function isPostHogActivityState(value: unknown): value is PostHogActivityState {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readPostHogActivityState(): PostHogActivityState {
  const stateFilePath = getPostHogActivityStateFilePath()
  if (!existsSync(stateFilePath)) {
    return {}
  }

  try {
    const content = readFileSync(stateFilePath, "utf-8")
    const parsed: unknown = JSON.parse(content)
    if (!isPostHogActivityState(parsed)) {
      return {}
    }
    return parsed
  } catch (error) {
    log("[posthog-activity-state] Failed to read activity state", {
      error: String(error),
      stateFilePath,
    })
    return {}
  }
}

function writePostHogActivityState(nextState: PostHogActivityState): void {
  const stateFilePath = getPostHogActivityStateFilePath()

  try {
    mkdirSync(join(getDataDir(), CACHE_DIR_NAME), { recursive: true })
    writeFileAtomically(stateFilePath, `${JSON.stringify(nextState, null, 2)}\n`)
  } catch (error) {
    log("[posthog-activity-state] Failed to write activity state", {
      error: String(error),
      stateFilePath,
    })
  }
}

export function getPostHogActivityCaptureState(now: Date = new Date()): PostHogActivityCaptureState {
  const state = readPostHogActivityState()
  const dayUTC = getUtcDayString(now)
  const hourUTC = getUtcHourString(now)

  const captureDaily = state.lastActiveDayUTC !== dayUTC
  const captureHourly = state.lastActiveHourUTC !== hourUTC

  if (captureDaily || captureHourly) {
    writePostHogActivityState({
      lastActiveDayUTC: captureDaily ? dayUTC : state.lastActiveDayUTC,
      lastActiveHourUTC: captureHourly ? hourUTC : state.lastActiveHourUTC,
    })
  }

  return {
    dayUTC,
    hourUTC,
    captureDaily,
    captureHourly,
  }
}
