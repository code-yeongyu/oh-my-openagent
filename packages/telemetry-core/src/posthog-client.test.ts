import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  createTelemetryClient,
  getTelemetryActivityStateFilePath,
  getTelemetryDistinctId,
  recordDailyActive,
} from "./index"
import type {
  TelemetryCaptureMessage,
  TelemetryOsProvider,
  TelemetryProductConfig,
  TelemetryTransport,
  TelemetryTransportFactory,
} from "./index"

const PRODUCT = {
  cacheDirName: "omo-codex",
  defaultApiKey: DEFAULT_POSTHOG_API_KEY,
  defaultHost: DEFAULT_POSTHOG_HOST,
  eventName: "omo_codex_daily_active",
  machineIdPrefix: "omo-codex:",
  packageName: "@oh-my-opencode/omo-codex",
  packageVersion: "4.9.2",
  platform: "omo-codex",
  productName: "omo-codex",
  productEnvPrefix: "OMO_CODEX",
} satisfies TelemetryProductConfig

const OS_PROVIDER = {
  arch: () => "arm64",
  cpus: () => [{ model: "Apple M-test" }],
  hostname: () => "test-host",
  platform: () => "darwin",
  release: () => "26.0.0",
  totalmem: () => 17_179_869_184,
  type: () => "Darwin",
} satisfies TelemetryOsProvider

function createCapturingFactory(capturedMessages: TelemetryCaptureMessage[]): TelemetryTransportFactory {
  return () => ({
    capture: (message) => {
      capturedMessages.push(message)
    },
    flush: async () => undefined,
    shutdown: async () => undefined,
  })
}

describe("posthog telemetry client", () => {
  test("#given codex product parameters #when daily active is captured #then payload shape matches current contract", async () => {
    // given
    const capturedMessages: TelemetryCaptureMessage[] = []
    const client = createTelemetryClient({
      env: { POSTHOG_API_KEY: "test-key", POSTHOG_HOST: "https://posthog.test" },
      osProvider: OS_PROVIDER,
      product: PRODUCT,
      source: "cli",
      transportFactory: createCapturingFactory(capturedMessages),
    })

    // when
    client.trackActive({
      dayUTC: "2026-05-25",
      distinctId: getTelemetryDistinctId(PRODUCT.machineIdPrefix, OS_PROVIDER),
      reason: "cli_run",
    })
    await client.flush()
    await client.shutdown()

    // then
    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]).toEqual({
      distinctId: createHash("sha256").update("omo-codex:test-host").digest("hex"),
      event: "omo_codex_daily_active",
      properties: {
        platform: "omo-codex",
        product_name: "omo-codex",
        package_name: "@oh-my-opencode/omo-codex",
        package_version: "4.9.2",
        runtime: "bun",
        runtime_version: process.versions.bun ?? process.version,
        source: "cli",
        $os: "darwin",
        $os_version: "26.0.0",
        os_arch: "arm64",
        os_type: "Darwin",
        cpu_count: 1,
        cpu_model: "Apple M-test",
        total_memory_gb: 16,
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        shell: process.env.SHELL,
        ci: Boolean(process.env.CI),
        terminal: process.env.TERM_PROGRAM,
        $process_person_profile: false,
        day_utc: "2026-05-25",
        reason: "cli_run",
      },
    })
  })

  test("#given a state dir and fake transport #when daily active records twice same day #then only one event is sent", async () => {
    // given
    const capturedMessages: TelemetryCaptureMessage[] = []
    const stateDir = mkdtempSync(join(tmpdir(), "telemetry-core-record-"))

    try {
      const options = {
        env: { POSTHOG_API_KEY: "test-key" },
        now: new Date("2026-05-25T01:02:03.000Z"),
        osProvider: OS_PROVIDER,
        product: PRODUCT,
        reason: "session_start",
        source: "plugin",
        stateDir,
        transportFactory: createCapturingFactory(capturedMessages),
      } as const

      // when
      await recordDailyActive(options)
      await recordDailyActive(options)

      // then
      expect(capturedMessages).toHaveLength(1)
      const message = capturedMessages[0]
      if (message === undefined || message.properties === undefined) {
        throw new Error("expected one captured message with properties")
      }
      expect(message.properties.day_utc).toBe("2026-05-25")
      expect(message.properties.reason).toBe("session_start")
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  test("#given no API key after trimming #when client is created #then transport is not constructed", () => {
    // given
    let transportCreated = false

    // when
    const client = createTelemetryClient({
      env: { POSTHOG_API_KEY: " " },
      osProvider: OS_PROVIDER,
      product: PRODUCT,
      source: "install",
      transportFactory: () => {
        transportCreated = true
        const transport: TelemetryTransport = {
          capture: () => undefined,
          shutdown: async () => undefined,
        }
        return transport
      },
    })
    client.trackActive({
      dayUTC: "2026-05-25",
      distinctId: "distinct",
      reason: "install_completed",
    })

    // then
    expect(transportCreated).toBe(false)
  })

  test("#given telemetry is disabled #when daily active records #then dedup state is not written", async () => {
    // given
    const capturedMessages: TelemetryCaptureMessage[] = []
    const stateDir = mkdtempSync(join(tmpdir(), "telemetry-core-disabled-"))
    const stateFilePath = getTelemetryActivityStateFilePath(stateDir)

    try {
      // when
      await recordDailyActive({
        env: { OMO_CODEX_DISABLE_POSTHOG: "1", POSTHOG_API_KEY: "test-key" },
        now: new Date("2026-05-25T01:02:03.000Z"),
        osProvider: OS_PROVIDER,
        product: PRODUCT,
        reason: "session_start",
        source: "plugin",
        stateDir,
        transportFactory: createCapturingFactory(capturedMessages),
      })

      // then
      expect(capturedMessages).toHaveLength(0)
      expect(existsSync(stateFilePath)).toBe(false)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  test("#given blank API key #when daily active records #then dedup state is not written", async () => {
    // given
    const capturedMessages: TelemetryCaptureMessage[] = []
    const stateDir = mkdtempSync(join(tmpdir(), "telemetry-core-no-key-"))
    const stateFilePath = getTelemetryActivityStateFilePath(stateDir)

    try {
      // when
      await recordDailyActive({
        env: { POSTHOG_API_KEY: " " },
        now: new Date("2026-05-25T01:02:03.000Z"),
        osProvider: OS_PROVIDER,
        product: PRODUCT,
        reason: "session_start",
        source: "plugin",
        stateDir,
        transportFactory: createCapturingFactory(capturedMessages),
      })

      // then
      expect(capturedMessages).toHaveLength(0)
      expect(existsSync(stateFilePath)).toBe(false)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
