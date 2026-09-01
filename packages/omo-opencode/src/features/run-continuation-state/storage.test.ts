import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  clearContinuationMarker,
  isContinuationMarkerActive,
  readContinuationMarker,
  setContinuationMarkerSource,
} from "./storage"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-run-marker-"))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("run-continuation-state storage", () => {
  it("stores and reads per-source marker state", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_test"

    // when
    setContinuationMarkerSource(directory, sessionID, "todo", "active", "2 todos remaining")
    setContinuationMarkerSource(directory, sessionID, "stop", "stopped", "user requested stop")
    const marker = readContinuationMarker(directory, sessionID)

    // then
    expect(marker).not.toBeNull()
    expect(marker?.sessionID).toBe(sessionID)
    expect(marker?.sources.todo?.state).toBe("active")
    expect(marker?.sources.todo?.reason).toBe("2 todos remaining")
    expect(marker?.sources.stop?.state).toBe("stopped")
  })

  it("treats marker as active when any source is active", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_active"
    setContinuationMarkerSource(directory, sessionID, "todo", "active", "pending")
    setContinuationMarkerSource(directory, sessionID, "stop", "idle")
    const marker = readContinuationMarker(directory, sessionID)

    // when
    const isActive = isContinuationMarkerActive(marker)

    // then
    expect(isActive).toBe(true)
  })

  it("returns inactive when no source is active", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_idle"
    setContinuationMarkerSource(directory, sessionID, "todo", "idle")
    setContinuationMarkerSource(directory, sessionID, "stop", "stopped")
    const marker = readContinuationMarker(directory, sessionID)

    // when
    const isActive = isContinuationMarkerActive(marker)

    // then
    expect(isActive).toBe(false)
  })

  it("clears marker for a session", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_clear"
    setContinuationMarkerSource(directory, sessionID, "todo", "active")

    // when
    clearContinuationMarker(directory, sessionID)
    const marker = readContinuationMarker(directory, sessionID)

    // then
    expect(marker).toBeNull()
  })
})
