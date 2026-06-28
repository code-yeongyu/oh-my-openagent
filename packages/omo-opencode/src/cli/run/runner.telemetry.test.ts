import { afterEach, describe, expect, it, mock } from "bun:test"
import type { TelemetryCaptureMessage, TelemetryTransportFactory } from "@oh-my-opencode/telemetry-core"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as posthogModule from "../../shared/posthog"
import type * as runnerModuleType from "./runner"

async function* createEmptyEventStream(): AsyncIterable<unknown> {}

let testPluginConfig: { readonly telemetry?: boolean } = {}

mock.module("../../plugin-config", () => ({
  loadPluginConfig: mock(() => testPluginConfig),
}))
mock.module("./agent-resolver", () => ({
  resolveRunAgent: mock(() => "Sisyphus - Ultraworker"),
}))
mock.module("./server-connection", () => ({
  createServerConnection: mock(async () => ({
    client: {
      event: {
        subscribe: mock(async () => ({ stream: createEmptyEventStream() })),
      },
      session: {
        promptAsync: mock(async () => undefined),
      },
    },
    cleanup: mock(() => {}),
  })),
}))
mock.module("./session-resolver", () => ({
  resolveSession: mock(async () => "ses_test"),
}))
mock.module("./json-output", () => ({
  createJsonOutputManager: mock(() => ({
    redirectToStderr: mock(() => {}),
    restore: mock(() => {}),
    emitResult: mock(() => {}),
  })),
}))
mock.module("./on-complete-hook", () => ({
  executeOnCompleteHook: mock(async () => {}),
}))
mock.module("./model-resolver", () => ({
  resolveRunModel: mock(() => null),
}))
mock.module("./poll-for-completion", () => ({
  pollForCompletion: mock(async () => 0),
}))
mock.module("./prompt-start", () => ({
  waitForPromptStart: mock(async () => {}),
}))
mock.module("./agent-profile-colors", () => ({
  loadAgentProfileColors: mock(async () => ({})),
}))
mock.module("./stdin-suppression", () => ({
  suppressRunInput: mock(() => mock(() => {})),
}))
mock.module("./timestamp-output", () => ({
  createTimestampedStdoutController: mock(() => ({
    enable: mock(() => {}),
    restore: mock(() => {}),
  })),
}))

const runnerModulePath = ["./runner?telemetry", "isolation"].join("-")
const runnerModule: typeof runnerModuleType = await import(runnerModulePath)
const { run } = runnerModule

function enableTelemetryEnv(): void {
  process.env.OMO_DISABLE_POSTHOG = "0"
  process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "1"
  process.env.POSTHOG_API_KEY = "test-api-key"
}

function clearTelemetryEnv(): void {
  delete process.env.OMO_DISABLE_POSTHOG
  delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
  delete process.env.POSTHOG_API_KEY
}

function createCapturingTransportFactory(capturedMessages: TelemetryCaptureMessage[]): TelemetryTransportFactory {
  return () => ({
    capture: (message) => {
      capturedMessages.push(message)
    },
    shutdown: async () => undefined,
  })
}

function createThrowingTransportFactory(): TelemetryTransportFactory {
  return () => ({
    capture: () => {
      throw new Error("telemetry failed")
    },
    shutdown: async () => {
      throw new Error("shutdown failed")
    },
  })
}

function createRunConfigFixture(telemetry: boolean): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-run-telemetry-"))
  const configDirectory = join(directory, ".opencode")
  mkdirSync(configDirectory, { recursive: true })
  writeFileSync(
    join(configDirectory, "oh-my-openagent.jsonc"),
    JSON.stringify({ telemetry }),
  )
  return directory
}

function removeRunConfigFixture(directory: string): void {
  rmSync(directory, { recursive: true, force: true })
}

function resetTelemetrySeams(): void {
  posthogModule.__resetActivityStateProviderForTesting()
  posthogModule.__resetTransportFactoryForTesting()
  clearTelemetryEnv()
}

describe("run telemetry isolation", () => {
  afterEach(() => {
    resetTelemetrySeams()
    testPluginConfig = {}
  })

  it("does not capture CLI telemetry when config disables telemetry", async () => {
    // given
    enableTelemetryEnv()
    const directory = createRunConfigFixture(false)
    const capturedMessages: TelemetryCaptureMessage[] = []
    posthogModule.__setTransportFactoryForTesting(createCapturingTransportFactory(capturedMessages))
    posthogModule.__setActivityStateProviderForTesting(() => ({
      dayUTC: "2026-04-18",
      captureDaily: true,
    }))
    testPluginConfig = { telemetry: false }

    try {
      // when
      const result = await run({ directory, message: "test" })

      // then
      expect(result).toBe(0)
      expect(capturedMessages).toHaveLength(0)
    } finally {
      removeRunConfigFixture(directory)
    }
  })

  it("does not crash CLI run when telemetry throws", async () => {
    // given
    enableTelemetryEnv()
    posthogModule.__setTransportFactoryForTesting(createThrowingTransportFactory())
    posthogModule.__setActivityStateProviderForTesting(() => ({
      dayUTC: "2026-04-18",
      captureDaily: true,
    }))
    testPluginConfig = { telemetry: true }

    // when
    const result = await run({ message: "test" })

    // then
    expect(result).toBe(0)
  })
})
