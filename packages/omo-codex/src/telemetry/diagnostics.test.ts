import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  cleanupTelemetryDiagnostics,
  getTelemetryDiagnosticsFilePath,
  writeTelemetryDiagnostic,
} from "./diagnostics"
import { CACHE_DIR_NAME } from "./product-identity"

const originalXdgDataHome = process.env.XDG_DATA_HOME
const tempPaths: string[] = []

function createDataHomePath(): string {
  const tempPath = mkdtempSync(join(tmpdir(), "omo-codex-diagnostics-"))
  tempPaths.push(tempPath)
  return tempPath
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readDiagnosticEntries(filePath: string): ReadonlyArray<Record<string, unknown>> {
  return readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      if (!isRecord(parsed)) {
        throw new Error("diagnostic line must be a JSON object")
      }
      return parsed
    })
}

afterEach(() => {
  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME
  } else {
    process.env.XDG_DATA_HOME = originalXdgDataHome
  }

  for (const tempPath of tempPaths.splice(0)) {
    rmSync(tempPath, { recursive: true, force: true })
  }
})

describe("telemetry diagnostics", () => {
  it("writes a telemetry failure as JSONL under the omo-codex data directory", () => {
    // given
    const dataHomePath = createDataHomePath()
    process.env.XDG_DATA_HOME = dataHomePath

    // when
    writeTelemetryDiagnostic(
      {
        event: "telemetry_capture_failed",
        error: new Error("capture failed"),
        source: "plugin",
      },
      new Date("2026-06-04T01:02:03.000Z"),
    )

    // then
    const diagnosticsFilePath = getTelemetryDiagnosticsFilePath()
    expect(diagnosticsFilePath).toBe(join(dataHomePath, CACHE_DIR_NAME, "telemetry-diagnostics.jsonl"))

    const entries = readDiagnosticEntries(diagnosticsFilePath)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      timestamp: "2026-06-04T01:02:03.000Z",
      event: "telemetry_capture_failed",
      source: "plugin",
      error_name: "Error",
      error_message: "capture failed",
    })
  })

  it("prunes stale diagnostics while preserving current entries and future writes", () => {
    // given
    const dataHomePath = createDataHomePath()
    process.env.XDG_DATA_HOME = dataHomePath
    const diagnosticsDir = join(dataHomePath, CACHE_DIR_NAME)
    const diagnosticsFilePath = join(diagnosticsDir, "telemetry-diagnostics.jsonl")
    mkdirSync(diagnosticsDir, { recursive: true })
    writeFileSync(
      diagnosticsFilePath,
      [
        JSON.stringify({
          timestamp: "2026-05-01T00:00:00.000Z",
          event: "telemetry_capture_failed",
          source: "plugin",
        }),
        JSON.stringify({
          timestamp: "2026-06-03T00:00:00.000Z",
          event: "telemetry_shutdown_failed",
          source: "plugin",
        }),
      ].join("\n") + "\n",
    )

    // when
    cleanupTelemetryDiagnostics(new Date("2026-06-04T00:00:00.000Z"))
    writeTelemetryDiagnostic(
      {
        event: "telemetry_capture_failed",
        error: new Error("next failure"),
        source: "plugin",
      },
      new Date("2026-06-04T00:01:00.000Z"),
    )

    // then
    expect(existsSync(diagnosticsFilePath)).toBe(true)
    const entries = readDiagnosticEntries(diagnosticsFilePath)
    expect(entries.map((entry) => entry.timestamp)).toEqual([
      "2026-06-03T00:00:00.000Z",
      "2026-06-04T00:01:00.000Z",
    ])
  })
})
