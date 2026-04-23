import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { ContinuationMarker, ContinuationMarkerSource, ContinuationMarkerState } from "./types"
import { CONTINUATION_MARKER_DIR } from "./constants"

function getMarkerFilePath(directory: string, sessionID: string): string {
  return join(directory, CONTINUATION_MARKER_DIR, `${sessionID}.json`)
}

export function readContinuationMarker(directory: string, sessionID: string): ContinuationMarker | null {
  const filePath = getMarkerFilePath(directory, sessionID)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as ContinuationMarker
  } catch {
    return null
  }
}

export function setContinuationMarkerSource(
  directory: string,
  sessionID: string,
  source: ContinuationMarkerSource,
  state: ContinuationMarkerState,
  reason?: string
): ContinuationMarker {
  const existing = readContinuationMarker(directory, sessionID)
  const now = new Date().toISOString()

  const marker: ContinuationMarker = existing ?? {
    sessionID,
    updatedAt: now,
    sources: {},
  }

  marker.updatedAt = now
  marker.sources[source] = {
    state,
    updatedAt: now,
    ...(reason !== undefined ? { reason } : {}),
  }

  const filePath = getMarkerFilePath(directory, sessionID)
  const dir = join(directory, CONTINUATION_MARKER_DIR)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(filePath, JSON.stringify(marker, null, 2), "utf-8")
  return marker
}

export function clearContinuationMarker(directory: string, sessionID: string): void {
  const filePath = getMarkerFilePath(directory, sessionID)

  try {
    rmSync(filePath, { force: true })
  } catch {
    // cleanup path — ignore errors
  }
}

export function isContinuationMarkerActive(marker: ContinuationMarker): boolean {
  return Object.values(marker.sources).some((entry) => entry?.state === "active")
}

export function getActiveContinuationMarkerReason(marker: ContinuationMarker): string | null {
  for (const entry of Object.values(marker.sources)) {
    if (entry?.state === "active" && entry.reason !== undefined) {
      return entry.reason
    }
  }
  return null
}
