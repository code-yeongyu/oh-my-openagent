import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  getDailyActiveCaptureState,
  getTelemetryActivityStateFilePath,
  resolveTelemetryStateDir,
  writeTelemetryDiagnostic,
} from "./index"

function createStateDir(): string {
  return mkdtempSync(join(tmpdir(), "telemetry-core-state-"))
}

function readState(filePath: string): { readonly lastActiveDayUTC?: string } {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"))
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("state must be object")
  }
  return parsed
}

describe("daily-active dedup state", () => {
  test("#given XDG_DATA_HOME #when telemetry state dir resolves #then product cache dir appears exactly once", () => {
    // given
    const xdgDataHome = createStateDir()

    try {
      // when
      const stateDir = resolveTelemetryStateDir(
        { cacheDirName: "omo-codex" },
        { env: { XDG_DATA_HOME: xdgDataHome } },
      )

      // then
      expect(stateDir).toBe(join(xdgDataHome, "omo-codex"))
      expect(getTelemetryActivityStateFilePath(stateDir)).toBe(
        join(xdgDataHome, "omo-codex", "posthog-activity.json"),
      )
    } finally {
      rmSync(xdgDataHome, { recursive: true, force: true })
    }
  })

  test("#given no state #when evaluated #then it sends once and writes current UTC day schema", () => {
    // given
    const stateDir = createStateDir()
    const stateFilePath = getTelemetryActivityStateFilePath(stateDir)

    try {
      // when
      const first = getDailyActiveCaptureState({
        stateDir,
        now: new Date("2026-05-25T01:02:03.000Z"),
      })
      const second = getDailyActiveCaptureState({
        stateDir,
        now: new Date("2026-05-25T23:59:59.000Z"),
      })

      // then
      expect(first).toEqual({ dayUTC: "2026-05-25", captureDaily: true })
      expect(second).toEqual({ dayUTC: "2026-05-25", captureDaily: false })
      expect(readState(stateFilePath)).toEqual({ lastActiveDayUTC: "2026-05-25" })
      expect(readFileSync(stateFilePath, "utf-8")).toBe('{\n  "lastActiveDayUTC": "2026-05-25"\n}\n')
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  test("#given stale state #when evaluated next day #then it sends and preserves schema field name", () => {
    // given
    const stateDir = createStateDir()
    const stateFilePath = getTelemetryActivityStateFilePath(stateDir)
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(stateFilePath, '{"lastActiveDayUTC":"2026-05-24"}\n')

    try {
      // when
      const result = getDailyActiveCaptureState({
        stateDir,
        now: new Date("2026-05-25T00:00:01.000Z"),
      })

      // then
      expect(result).toEqual({ dayUTC: "2026-05-25", captureDaily: true })
      expect(readState(stateFilePath)).toEqual({ lastActiveDayUTC: "2026-05-25" })
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  test("#given malformed state JSON #when evaluated #then it treats state as missing and records diagnostics", () => {
    // given
    const stateDir = createStateDir()
    const stateFilePath = getTelemetryActivityStateFilePath(stateDir)
    const diagnostics: string[] = []
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(stateFilePath, "{bad-json\n")

    try {
      // when
      const result = getDailyActiveCaptureState({
        diagnostics: (input) => {
          diagnostics.push(input.event)
          writeTelemetryDiagnostic(input, {
            diagnosticsDir: stateDir,
            now: new Date("2026-05-25T10:20:30.000Z"),
          })
        },
        stateDir,
        now: new Date("2026-05-25T10:20:30.000Z"),
      })

      // then
      expect(result).toEqual({ dayUTC: "2026-05-25", captureDaily: true })
      expect(diagnostics).toEqual(["telemetry_activity_state_read_failed"])
      expect(readFileSync(join(stateDir, "telemetry-diagnostics.jsonl"), "utf-8")).toContain(
        '"event":"telemetry_activity_state_read_failed"',
      )
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
