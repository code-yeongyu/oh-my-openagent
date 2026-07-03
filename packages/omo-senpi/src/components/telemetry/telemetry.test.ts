/// <reference types="bun-types" />

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  createTelemetryClient,
  getTelemetryActivityStateFilePath,
  getTelemetryDistinctId,
  type TelemetryCaptureMessage,
  type TelemetryEnv,
  type TelemetryOsProvider,
  type TelemetryTransport,
  type TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  SENPI_MACHINE_ID_PREFIX,
  SENPI_TELEMETRY_EVENT_NAME,
  createSenpiTelemetryComponent,
  createSenpiTelemetryProductConfig,
  getSenpiTelemetryStateDir,
  recordSenpiDailyActive,
} from "./index"
import type { ComponentLogger } from "../../extension/types"

type RecordedTransport = {
  readonly messages: readonly TelemetryCaptureMessage[]
  readonly factory: TelemetryTransportFactory
}

const FIXED_NOW = new Date("2026-07-03T04:05:06.000Z")

function createOsProvider(hostname: string): TelemetryOsProvider {
  return {
    arch: () => "arm64",
    cpus: () => [{ model: "Senpi Test CPU" }],
    hostname: () => hostname,
    platform: () => "darwin",
    release: () => "26.3.1",
    totalmem: () => 128 * 1024 * 1024 * 1024,
    type: () => "Darwin",
  }
}

function createEnabledEnv(agentDir: string): TelemetryEnv {
  return {
    POSTHOG_API_KEY: "test-api-key",
    SENPI_CODING_AGENT_DIR: agentDir,
  }
}

function createTransportRecorder(): RecordedTransport {
  const messages: TelemetryCaptureMessage[] = []
  return {
    messages,
    factory: () => ({
      capture(message) {
        messages.push(message)
      },
      flush: async () => undefined,
      shutdown: async () => undefined,
    }),
  }
}

function createSilentLogger(): ComponentLogger {
  return {
    info() {
      return
    },
    warn() {
      return
    },
    error() {
      return
    },
  }
}

function createRejectingTransportRecorder(messages: TelemetryCaptureMessage[]): TelemetryTransportFactory {
  return () => ({
    capture(message) {
      messages.push(message)
    },
    flush: async () => {
      throw new Error("flush failed")
    },
    shutdown: async () => undefined,
  })
}

function createHangingTransportRecorder(messages: TelemetryCaptureMessage[]): TelemetryTransportFactory {
  return () => ({
    capture(message) {
      messages.push(message)
    },
    flush: () => new Promise<void>(() => undefined),
    shutdown: async () => undefined,
  })
}

function createTempAgentDir(): string {
  return mkdtempSync(join(tmpdir(), "omo-senpi-telemetry-test-"))
}

function readStamp(stateDir: string): unknown {
  return JSON.parse(readFileSync(getTelemetryActivityStateFilePath(stateDir), "utf-8"))
}

async function withTempAgentDir<T>(run: (agentDir: string) => Promise<T>): Promise<T> {
  const agentDir = createTempAgentDir()
  try {
    return await run(agentDir)
  } finally {
    rmSync(agentDir, { recursive: true, force: true })
  }
}

describe("omo-senpi telemetry", () => {
  it("#given no daily stamp #when session_start fires #then first session emits daily-active telemetry", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = new FakeExtensionAPI()
      const transport = createTransportRecorder()

      // when
      createSenpiTelemetryComponent({
        env: createEnabledEnv(agentDir),
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-first-host"),
        timeoutMs: 50,
        transportFactory: transport.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch("session_start", {})
      await recordSenpiDailyActive({
        env: createEnabledEnv(agentDir),
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-first-host"),
        stateDir: getSenpiTelemetryStateDir(createEnabledEnv(agentDir)),
        timeoutMs: 50,
        transportFactory: transport.factory,
      })

      // then
      expect(transport.messages).toHaveLength(1)
      expect(transport.messages[0]?.event).toBe(SENPI_TELEMETRY_EVENT_NAME)
    })
  })

  it("#given a same-day stamp #when session_start fires again #then second same-day session does not emit", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const transport = createTransportRecorder()
      const options = {
        env: createEnabledEnv(agentDir),
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-repeat-host"),
        timeoutMs: 50,
        transportFactory: transport.factory,
      }

      // when
      await recordSenpiDailyActive(options)
      await recordSenpiDailyActive(options)

      // then
      expect(transport.messages).toHaveLength(1)
    })
  })

  it.each([
    ["product disable opt-out", { OMO_SENPI_DISABLE_POSTHOG: "1" }],
    ["product anonymous telemetry opt-out", { OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: "0" }],
    ["global opt-out", { OMO_DISABLE_POSTHOG: "1" }],
  ])("#given %s #when session_start fires #then opt-out suppresses emission and stamp writes", async (_name, optOutEnv) => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const transport = createTransportRecorder()
      const env = {
        ...createEnabledEnv(agentDir),
        ...optOutEnv,
      }
      const stateDir = getSenpiTelemetryStateDir(env)

      // when
      await recordSenpiDailyActive({
        env,
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-opt-out-host"),
        timeoutMs: 50,
        transportFactory: transport.factory,
      })

      // then
      expect(transport.messages).toEqual([])
      expect(existsSync(getTelemetryActivityStateFilePath(stateDir))).toBe(false)
    })
  })

  it("#given SENPI_CODING_AGENT_DIR #when telemetry records #then stamp file location respects the isolated senpi agent dir", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const transport = createTransportRecorder()
      const env = createEnabledEnv(agentDir)
      const stateDir = getSenpiTelemetryStateDir(env)

      // when
      await recordSenpiDailyActive({
        env,
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-stamp-host"),
        timeoutMs: 50,
        transportFactory: transport.factory,
      })

      // then
      expect(stateDir.startsWith(agentDir)).toBe(true)
      expect(readStamp(stateDir)).toEqual({ lastActiveDayUTC: "2026-07-03" })
    })
  })

  it("#given telemetry component and telemetry-core builder #when session_start captures through injected transport #then payload equivalence holds", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = new FakeExtensionAPI()
      const componentTransport = createTransportRecorder()
      const coreTransport = createTransportRecorder()
      const env = createEnabledEnv(agentDir)
      const osProvider = createOsProvider("senpi-payload-host")
      const expectedDistinctId = getTelemetryDistinctId(SENPI_MACHINE_ID_PREFIX, osProvider)
      createSenpiTelemetryComponent({
        env,
        now: FIXED_NOW,
        osProvider,
        timeoutMs: 50,
        transportFactory: componentTransport.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      const coreClient = createTelemetryClient({
        env,
        osProvider,
        product: createSenpiTelemetryProductConfig(),
        source: "senpi-extension",
        transportFactory: coreTransport.factory,
      })

      // when
      await pi.dispatch("session_start", {})
      coreClient.trackActive({
        dayUTC: "2026-07-03",
        distinctId: expectedDistinctId,
        reason: "session_start",
      })
      await coreClient.flush()
      await coreClient.shutdown()

      // then
      expect(createSenpiTelemetryProductConfig()).toMatchObject({
        defaultApiKey: DEFAULT_POSTHOG_API_KEY,
        defaultHost: DEFAULT_POSTHOG_HOST,
        eventName: SENPI_TELEMETRY_EVENT_NAME,
        machineIdPrefix: SENPI_MACHINE_ID_PREFIX,
        packageName: "@oh-my-opencode/omo-senpi",
        platform: "omo-senpi",
        productEnvPrefix: "OMO_SENPI",
        productName: "omo-senpi",
      })
      expect(componentTransport.messages).toEqual(coreTransport.messages)
    })
  })

  it("#given missing env and empty session payload #when session_start fires #then defaults are safe and no exception escapes", async () => {
    await withTempAgentDir(async (stateDir) => {
      // given
      const pi = new FakeExtensionAPI()
      const messages: TelemetryCaptureMessage[] = []

      // when
      createSenpiTelemetryComponent({
        env: { POSTHOG_API_KEY: "test-api-key" },
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-empty-input-host"),
        stateDir,
        timeoutMs: 50,
        transportFactory: createRejectingTransportRecorder(messages),
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch("session_start", {})

      // then
      expect(messages).toHaveLength(1)
    })
  })

  it("#given a hanging transport #when session_start fires #then send failure does not block the session_start path", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = new FakeExtensionAPI()
      const messages: TelemetryCaptureMessage[] = []
      createSenpiTelemetryComponent({
        env: createEnabledEnv(agentDir),
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-hanging-host"),
        timeoutMs: 1,
        transportFactory: createHangingTransportRecorder(messages),
      }).register(pi, { config: pi, logger: createSilentLogger() })

      // when
      await pi.dispatch("session_start", {})

      // then
      expect(messages).toHaveLength(1)
    })
  })
})
