import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { getTelemetryDiagnosticsFilePath, writeTelemetryDiagnostic } from "./index"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function createDiagnosticsDir(): string {
  const diagnosticsDir = mkdtempSync(join(tmpdir(), "telemetry-diagnostics-"))
  cleanupRoots.push(diagnosticsDir)
  return diagnosticsDir
}

function readJsonLines(filePath: string): Array<Record<string, unknown>> {
  return readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("telemetry diagnostics", () => {
  test("#given expired and malformed diagnostics #when writing a new diagnostic #then cleanup keeps only valid retained lines", () => {
    // given
    const diagnosticsDir = createDiagnosticsDir()
    const diagnosticsFilePath = getTelemetryDiagnosticsFilePath(diagnosticsDir)
    mkdirSync(diagnosticsDir, { recursive: true })
    writeFileSync(
      diagnosticsFilePath,
      [
        JSON.stringify({ timestamp: "2026-05-01T00:00:00.000Z", event: "old", source: "shared" }),
        "{not-json",
        JSON.stringify({ timestamp: "2026-05-08T00:00:00.000Z", event: "retained", source: "shared" }),
        "",
      ].join("\n"),
      "utf-8",
    )

    // when
    writeTelemetryDiagnostic(
      {
        event: "new_event",
        source: "unit-test",
        error: new Error("boom"),
        errorKind: "error",
      },
      {
        diagnosticsDir,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    )
    const records = readJsonLines(diagnosticsFilePath)

    // then
    expect(records.map((record) => record.event)).toEqual(["retained", "new_event"])
    expect(records[1]).toMatchObject({
      timestamp: "2026-05-10T00:00:00.000Z",
      event: "new_event",
      source: "unit-test",
      error_kind: "error",
      error_name: "Error",
      error_message: "boom",
    })
  })
})
