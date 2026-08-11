import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createEventTelemetryClient,
  type TelemetryCaptureMessage,
  type TelemetryDiagnosticInput,
} from "@oh-my-opencode/telemetry-core"

import { createOmoNativePayloadBuffer, getOmoNativePayloadFilePath } from "./omo-native-buffer"
import { createOmoNativeProductConfig } from "./product-identity"
import { createTransportRecorder } from "./telemetry.test-support"

const tempDirs: string[] = []

function createTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "omo-native-buffer-test-"))
  tempDirs.push(path)
  return path
}

function payload(index: number, properties: Record<string, unknown> = {}): TelemetryCaptureMessage {
  return {
    distinctId: "machine-hash",
    event: "test_event",
    properties: { index, ...properties },
  }
}

function readPayloadFile(stateDir: string): TelemetryCaptureMessage[] {
  return JSON.parse(readFileSync(getOmoNativePayloadFilePath(stateDir), "utf8"))
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) {
    try {
      chmodSync(path, 0o700)
    } catch {
      // The path may already have been removed by the test.
    }
    rmSync(path, { recursive: true, force: true })
  }
})

describe("OmO Native payload buffer", () => {
  test("#given 60 captures #when retained in memory #then the last 50 remain in FIFO order", () => {
    // given
    const buffer = createOmoNativePayloadBuffer({ stateDir: createTempDir() })

    // when
    for (let index = 1; index <= 60; index += 1) buffer.onCapture(payload(index))

    // then
    expect(buffer.payloads).toHaveLength(50)
    expect(buffer.payloads[0]?.properties?.index).toBe(11)
    expect(buffer.payloads[49]?.properties?.index).toBe(60)
  })

  test("#given an event client observer #when capture succeeds #then the preview file matches the buffer", () => {
    // given
    const stateDir = createTempDir()
    const buffer = createOmoNativePayloadBuffer({ stateDir })
    const transport = createTransportRecorder()
    const client = createEventTelemetryClient({
      distinctId: "machine-hash",
      env: { POSTHOG_API_KEY: "test-key" },
      onCapture: buffer.onCapture,
      product: createOmoNativeProductConfig(),
      propertyAllowlist: { daily_active: ["reason"] },
      schemaVersion: 1,
      source: "test",
      transportFactory: transport.factory,
    })

    // when
    client.captureEvent("daily_active", { reason: "session_start" })

    // then
    expect(readPayloadFile(stateDir)).toEqual([...buffer.payloads])
    expect([...buffer.payloads]).toEqual([...transport.messages])
  })

  test("#given stale preview content #when a payload is captured #then the file is atomically replaced rather than appended", () => {
    // given
    const stateDir = createTempDir()
    const filePath = getOmoNativePayloadFilePath(stateDir)
    writeFileSync(filePath, "stale previous run")
    const buffer = createOmoNativePayloadBuffer({ stateDir })

    // when
    buffer.onCapture(payload(1))

    // then
    expect(readPayloadFile(stateDir)).toEqual([payload(1)])
    expect(readFileSync(filePath, "utf8")).not.toContain("stale previous run")
    expect(existsSync(`${filePath}.tmp`)).toBe(false)
  })

  test("#given oversized payloads #when mirrored #then the JSON file stays within 64KB", () => {
    // given
    const stateDir = createTempDir()
    const buffer = createOmoNativePayloadBuffer({ stateDir })

    // when
    for (let index = 1; index <= 50; index += 1) {
      buffer.onCapture(payload(index, { huge: "x".repeat(70_000) }))
    }

    // then
    const content = readFileSync(getOmoNativePayloadFilePath(stateDir))
    expect(content.byteLength).toBeLessThanOrEqual(64 * 1024)
    expect(() => JSON.parse(content.toString("utf8"))).not.toThrow()
    expect(buffer.payloads).toHaveLength(50)
  })

  test("#given 100 tight-loop captures #when each mirror replaces the prior file #then the final JSON is complete and uncorrupted", () => {
    // given
    const stateDir = createTempDir()
    const buffer = createOmoNativePayloadBuffer({ stateDir })

    // when
    for (let index = 1; index <= 100; index += 1) buffer.onCapture(payload(index))

    // then
    expect(() => readPayloadFile(stateDir)).not.toThrow()
    expect(readPayloadFile(stateDir)).toEqual([...buffer.payloads])
    expect(readPayloadFile(stateDir)[0]?.properties?.index).toBe(51)
  })

  test("#given an unwritable state directory #when capture repeats #then memory continues and one diagnostic is emitted", () => {
    // given
    const stateDir = createTempDir()
    const diagnostics: TelemetryDiagnosticInput[] = []
    const buffer = createOmoNativePayloadBuffer({
      diagnostics: (input) => diagnostics.push(input),
      stateDir,
    })
    chmodSync(stateDir, 0o500)

    try {
      // when / then
      expect(() => {
        buffer.onCapture(payload(1))
        buffer.onCapture(payload(2))
      }).not.toThrow()
      expect(buffer.payloads).toEqual([payload(1), payload(2)])
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]?.event).toBe("telemetry_capture_failed")
    } finally {
      chmodSync(stateDir, 0o700)
    }
  })

  test("#given circular and undefined values #when capture is observed #then capture never throws or creates corrupt JSON", () => {
    // given
    const stateDir = createTempDir()
    const diagnostics: TelemetryDiagnosticInput[] = []
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const buffer = createOmoNativePayloadBuffer({
      diagnostics: (input) => diagnostics.push(input),
      stateDir,
    })

    // when / then
    expect(() => buffer.onCapture(payload(1, { circular }))).not.toThrow()
    expect(() => buffer.onCapture(payload(2, { missing: undefined }))).not.toThrow()
    expect(buffer.payloads).toHaveLength(2)
    expect(diagnostics).toHaveLength(1)
    if (existsSync(getOmoNativePayloadFilePath(stateDir))) {
      expect(() => readPayloadFile(stateDir)).not.toThrow()
    }
  })
})
