import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setContinuationMarkerSource } from "../../features/run-continuation-state"
import { getContinuationState } from "./continuation-state"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-run-cont-state-"))
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

describe("getContinuationState marker integration", () => {
  it("reports active marker state from continuation hooks", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_marker_active"
    setContinuationMarkerSource(directory, sessionID, "todo", "active", "todos remaining")

    // when
    const state = getContinuationState(directory, sessionID)

    // then
    expect(state.hasActiveHookMarker).toBe(true)
    expect(state.activeHookMarkerReason).toContain("todos")
  })

  it("does not report active marker when all sources are idle/stopped", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_marker_idle"
    setContinuationMarkerSource(directory, sessionID, "todo", "idle")
    setContinuationMarkerSource(directory, sessionID, "stop", "stopped")

    // when
    const state = getContinuationState(directory, sessionID)

    // then
    expect(state.hasActiveHookMarker).toBe(false)
    expect(state.activeHookMarkerReason).toBeNull()
  })
})
