import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  UNCONFIGURED_POSTHOG_API_KEY,
  createDefaultPostHogTransport,
  createTelemetryClient,
  getTelemetryActivityStateFilePath,
  isTelemetryClientEnabled,
  recordDailyActive,
} from "./index"
import { TELEMETRY_INSTALL_ID_FILE_NAME } from "./install-id"
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
  test("#given the unconfigured OmO Native placeholder and clean env #when clients are created #then telemetry fails closed without constructing transports", () => {
    let transportsCreated = 0
    const input = {
      env: {},
      osProvider: OS_PROVIDER,
      product: {
        ...PRODUCT,
        defaultApiKey: UNCONFIGURED_POSTHOG_API_KEY,
        productEnvPrefix: "OMO_SENPI",
      },
      source: "plugin",
      transportFactory: () => {
        transportsCreated += 1
        return {
          capture: () => undefined,
          shutdown: async () => undefined,
        }
      },
    } as const

    const first = createTelemetryClient(input)
    const second = createTelemetryClient(input)

    expect(isTelemetryClientEnabled(input)).toBe(false)
    expect([first.enabled, second.enabled]).toEqual([false, false])
    expect(transportsCreated).toBe(0)
  })

  test("#given the placeholder default and a real env override #when enabled state is checked #then telemetry is enabled", () => {
    expect(isTelemetryClientEnabled({
      env: { POSTHOG_API_KEY: "phc_test" },
      product: {
        defaultApiKey: UNCONFIGURED_POSTHOG_API_KEY,
        productEnvPrefix: "OMO_SENPI",
      },
    })).toBe(true)
  })

  test("#given the legacy shared key as the default #when enabled state is checked #then telemetry remains enabled", () => {
    expect(isTelemetryClientEnabled({
      env: {},
      product: PRODUCT,
    })).toBe(true)
  })

  test("#given a real OmO Native default replaces the placeholder #when enabled state is checked #then telemetry activates without another flag", () => {
    expect(isTelemetryClientEnabled({
      env: {},
      product: {
        defaultApiKey: "phc_omo_native_project_key",
        productEnvPrefix: "OMO_SENPI",
      },
    })).toBe(true)
  })

  test("#given codex product parameters #when daily active is captured #then payload shape matches current contract", async () => {
    // given
    const savedTermProgram = process.env.TERM_PROGRAM
    process.env.TERM_PROGRAM = "WezTerm"
    const previousShell = process.env.SHELL
    process.env.SHELL = "/home/contract-user/.nix-profile/bin/zsh"
    const capturedMessages: TelemetryCaptureMessage[] = []
    const client = (() => {
      try {
        return createTelemetryClient({
          env: { POSTHOG_API_KEY: "test-key", POSTHOG_HOST: "https://posthog.test" },
          osProvider: OS_PROVIDER,
          product: PRODUCT,
          source: "cli",
          transportFactory: createCapturingFactory(capturedMessages),
        })
      } finally {
        if (savedTermProgram === undefined) delete process.env.TERM_PROGRAM
        else process.env.TERM_PROGRAM = savedTermProgram
      }
    })()

    // when
    client.trackActive({
      dayUTC: "2026-05-25",
      distinctId: "a".repeat(64),
      reason: "cli_run",
    })
    await client.flush()
    await client.shutdown()
    if (previousShell === undefined) delete process.env.SHELL
    else process.env.SHELL = previousShell

    // then
    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]).toEqual({
      distinctId: "a".repeat(64),
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
        shell: "zsh",
        ci: Boolean(process.env.CI),
        terminal: "WezTerm",
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
      expect(existsSync(join(stateDir, TELEMETRY_INSTALL_ID_FILE_NAME))).toBe(true)
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

  test("#given a transport whose flush rejects #when daily active records #then the transport is still shut down", async () => {
    // given
    const stateDir = mkdtempSync(join(tmpdir(), "telemetry-core-flush-fails-"))
    let shutdowns = 0
    const transportFactory: TelemetryTransportFactory = () => ({
      capture: () => undefined,
      flush: async () => {
        throw new Error("collector answered 500")
      },
      shutdown: async () => {
        shutdowns += 1
      },
    })

    try {
      // when
      const recorded = recordDailyActive({
        env: { POSTHOG_API_KEY: "test-key" },
        now: new Date("2026-05-25T01:02:03.000Z"),
        osProvider: OS_PROVIDER,
        product: PRODUCT,
        reason: "session_start",
        source: "plugin",
        stateDir,
        transportFactory,
      })

      // then
      await expect(recorded).rejects.toThrow("collector answered 500")
      expect(shutdowns).toBe(1)
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

  // Privacy-notice contract (#11583): while any opt-out is set, nothing is sent and no install id file is created.
  test.each([
    ["DO_NOT_TRACK", { DO_NOT_TRACK: "1" }],
    ["OMO_DISABLE_TELEMETRY", { OMO_DISABLE_TELEMETRY: "1" }],
    ["OMO_DISABLE_POSTHOG", { OMO_DISABLE_POSTHOG: "1" }],
    ["OMO_SEND_ANONYMOUS_TELEMETRY=0", { OMO_SEND_ANONYMOUS_TELEMETRY: "0" }],
    ["OMO_CODEX_DISABLE_POSTHOG", { OMO_CODEX_DISABLE_POSTHOG: "1" }],
  ] as const)("#given telemetry is disabled by %s #when daily active records #then no dedup state or install id file is written", async (_name, optOut) => {
    // given
    const capturedMessages: TelemetryCaptureMessage[] = []
    const stateDir = mkdtempSync(join(tmpdir(), "telemetry-core-disabled-"))
    const stateFilePath = getTelemetryActivityStateFilePath(stateDir)

    try {
      // when
      await recordDailyActive({
        env: { ...optOut, POSTHOG_API_KEY: "test-key" },
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
      expect(existsSync(join(stateDir, TELEMETRY_INSTALL_ID_FILE_NAME))).toBe(false)
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

  // Acknowledgment contract: an ack-gated event (session_summary) may be retired only once it is on the
  // wire. posthog-node's capture() enqueues after an async prepare step that flush() does not wait for, so
  // the transport exposes captureImmediate, whose promise resolves after the HTTP request was answered.
  test("#given the real PostHog transport #when an event is captured immediately #then the request carrying its uuid and time was sent before the promise resolved", async () => {
    // given
    const bodies: string[] = []
    const options = {
      // A loopback host: the injected fetch answers, and the test guard (#10394) refuses any other host.
      host: "http://127.0.0.1:9",
      disableGeoip: true,
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
      strictLocalEvaluation: true,
      disableRemoteConfig: true,
      disableCompression: true,
      flushAt: 20,
      flushInterval: 10_000,
      fetch: async (_url: string, init: { readonly body?: unknown }) => {
        bodies.push(String(init.body))
        return new Response("{}", { status: 200 })
      },
    }
    const transport = createDefaultPostHogTransport("test-key", options)
    const uuid = "0b6c5d3e-2f1a-4c8b-9d7e-6a5b4c3d2e1f"
    const createdAt = new Date("2026-05-25T01:02:03.000Z")

    try {
      // when
      expect(transport.captureImmediate).toBeFunction()
      await transport.captureImmediate?.({ distinctId: "machine-hash", event: "session_summary", properties: { turns: 1 }, uuid, timestamp: createdAt })

      // then
      const wire = bodies.join("\n")
      expect(wire).toContain(uuid)
      expect(wire).toContain(createdAt.toISOString())
    } finally {
      await transport.shutdown()
    }
  })
})
