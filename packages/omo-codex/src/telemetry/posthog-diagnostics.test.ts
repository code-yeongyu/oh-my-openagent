import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CACHE_DIR_NAME } from "./product-identity"

type CapturedPostHogMessage = {
  readonly distinctId: string
  readonly event: string
  readonly properties?: Record<string, unknown>
}

type PostHogModule = typeof import("./posthog")

const originalXdgDataHome = process.env.XDG_DATA_HOME
const tempPaths: string[] = []

async function importPostHogModule(): Promise<PostHogModule> {
  return import(`./posthog?test=${Date.now()}-${Math.random()}`)
}

function clearTelemetryEnv(): void {
  delete process.env.OMO_DISABLE_POSTHOG
  delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
  delete process.env.OMO_CODEX_DISABLE_POSTHOG
  delete process.env.OMO_CODEX_SEND_ANONYMOUS_TELEMETRY
  delete process.env.POSTHOG_API_KEY
  delete process.env.POSTHOG_HOST
}

function createDataHomePath(): string {
  const tempPath = mkdtempSync(join(tmpdir(), "omo-codex-posthog-diagnostics-"))
  mkdirSync(join(tempPath, CACHE_DIR_NAME), { recursive: true })
  tempPaths.push(tempPath)
  return tempPath
}

function getDiagnosticsFilePath(dataHomePath: string): string {
  return join(dataHomePath, CACHE_DIR_NAME, "telemetry-diagnostics.jsonl")
}

function mockPostHogCaptureFailure(posthog: PostHogModule): void {
  posthog.__setTransportFactoryForTesting(() => ({
    capture: () => {
      throw new Error("capture failed")
    },
    flush: async () => {},
    shutdown: async () => {},
  }))
}

function mockPostHogCaptureSymbolFailure(posthog: PostHogModule): void {
  const failure = Symbol("capture failed")
  posthog.__setTransportFactoryForTesting(() => ({
    capture: () => {
      throw failure
    },
    flush: async () => {},
    shutdown: async () => {},
  }))
}

function mockPostHogShutdownFailure(posthog: PostHogModule, capturedMessages: CapturedPostHogMessage[]): void {
  posthog.__setTransportFactoryForTesting(() => ({
    capture: (message: any) => {
      capturedMessages.push(message)
    },
    flush: async () => {},
    shutdown: async () => {
      throw new Error("shutdown failed")
    },
  }))
}

describe("omo-codex posthog telemetry diagnostics", () => {
  beforeEach(() => {
    mock.restore()
    clearTelemetryEnv()
  })

  afterEach(() => {
    mock.restore()
    clearTelemetryEnv()
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    }
    delete process.env.XDG_STATE_HOME
    for (const tempPath of tempPaths.splice(0)) {
      rmSync(tempPath, { recursive: true, force: true })
    }
  })

  it("swallows capture failure and writes diagnostics", async () => {
    // given
    const dataHomePath = createDataHomePath()
    process.env.XDG_DATA_HOME = dataHomePath
    process.env.XDG_STATE_HOME = dataHomePath
    process.env.POSTHOG_API_KEY = "test-api-key"
    const posthog = await importPostHogModule()
    mockPostHogCaptureFailure(posthog)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    const diagnostics = readFileSync(getDiagnosticsFilePath(dataHomePath), "utf-8")
    expect(diagnostics).toContain('"event":"telemetry_capture_failed"')
    expect(diagnostics).toContain('"source":"cli"')
    expect(diagnostics).toContain('"error_message":"capture failed"')
  })

  it("swallows non-Error capture failure and writes diagnostics", async () => {
    // given
    const dataHomePath = createDataHomePath()
    process.env.XDG_DATA_HOME = dataHomePath
    process.env.XDG_STATE_HOME = dataHomePath
    process.env.POSTHOG_API_KEY = "test-api-key"
    const posthog = await importPostHogModule()
    mockPostHogCaptureSymbolFailure(posthog)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    const diagnostics = readFileSync(getDiagnosticsFilePath(dataHomePath), "utf-8")
    expect(diagnostics).toContain('"event":"telemetry_capture_failed"')
    expect(diagnostics).toContain('"source":"cli"')
    expect(diagnostics).toContain('"error_name":"symbol"')
    expect(diagnostics).toContain('"error_message":"Symbol(capture failed)"')
  })

  it("swallows shutdown failure and writes diagnostics", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const capturedMessages: CapturedPostHogMessage[] = []
    process.env.XDG_DATA_HOME = dataHomePath
    process.env.XDG_STATE_HOME = dataHomePath
    process.env.POSTHOG_API_KEY = "test-api-key"
    const posthog = await importPostHogModule()
    mockPostHogShutdownFailure(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    await posthog.createCliPostHog().shutdown()

    // then
    const diagnostics = readFileSync(getDiagnosticsFilePath(dataHomePath), "utf-8")
    expect(diagnostics).toContain('"event":"telemetry_shutdown_failed"')
    expect(diagnostics).toContain('"source":"cli"')
    expect(diagnostics).toContain('"error_message":"shutdown failed"')
  })
})
