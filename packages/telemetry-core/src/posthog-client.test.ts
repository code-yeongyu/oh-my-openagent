import { createHash } from "node:crypto"
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  TELEMETRY_CONSENT_FILE_MODE,
  UNCONFIGURED_POSTHOG_API_KEY,
  createTelemetryClient,
  getTelemetryActivityStateFilePath,
  getTelemetryDistinctId,
  isTelemetryClientEnabled,
  readTelemetryConsentState,
  recordDailyActive,
  resolveTelemetryConsentStatePath,
  writeTelemetryConsentState,
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

/**
 * A consent answer is per machine and per product prefix, so every case that needs one
 * gets its own temp root instead of the real `~/.omo/state/telemetry.json`.
 */
const consentRoots: string[] = []

function consentStatePath(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-pr-b-consent-"))
  consentRoots.push(root)
  return join(root, "telemetry.json")
}

afterEach(() => {
  for (const root of consentRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("telemetry opt-in default", () => {
  test("#given no env flags and no answered consent file #when enabled state is checked #then telemetry is disabled", () => {
    // given
    const input = {
      consentStatePath: consentStatePath(),
      env: {},
      product: PRODUCT,
    } as const

    // when
    const enabled = isTelemetryClientEnabled(input)

    // then
    expect(existsSync(input.consentStatePath)).toBe(false)
    expect(enabled).toBe(false)
  })

  test("#given a persisted off answer #when enabled state is checked #then telemetry stays disabled", () => {
    // given
    const stateFilePath = consentStatePath()
    writeTelemetryConsentState(stateFilePath, { enabled: false })

    // when
    const enabled = isTelemetryClientEnabled({ consentStatePath: stateFilePath, env: {}, product: PRODUCT })

    // then
    expect(enabled).toBe(false)
  })

  test("#given a persisted on answer #when enabled state is checked #then telemetry is enabled", () => {
    // given
    const stateFilePath = consentStatePath()
    writeTelemetryConsentState(stateFilePath, { enabled: true })

    // when
    const enabled = isTelemetryClientEnabled({ consentStatePath: stateFilePath, env: {}, product: PRODUCT })

    // then
    expect(enabled).toBe(true)
  })

  test("#given a persisted off answer and a force-on env flag #when enabled state is checked #then the env flag wins", () => {
    // given
    const stateFilePath = consentStatePath()
    writeTelemetryConsentState(stateFilePath, { enabled: false })

    // when
    const enabled = isTelemetryClientEnabled({
      consentStatePath: stateFilePath,
      env: { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "1" },
      product: PRODUCT,
    })

    // then
    expect(enabled).toBe(true)
  })

  test("#given a persisted on answer and a force-off env flag #when enabled state is checked #then the disable flag wins", () => {
    // given
    const stateFilePath = consentStatePath()
    writeTelemetryConsentState(stateFilePath, { enabled: true })

    // when
    const enabled = isTelemetryClientEnabled({
      consentStatePath: stateFilePath,
      env: { OMO_DISABLE_POSTHOG: "1" },
      product: PRODUCT,
    })

    // then
    expect(enabled).toBe(false)
  })

  test("#given both a force-on and a disable env flag #when enabled state is checked #then telemetry is disabled", () => {
    // given
    const input = {
      consentStatePath: consentStatePath(),
      env: { OMO_DISABLE_POSTHOG: "1", OMO_SEND_ANONYMOUS_TELEMETRY: "1" },
      product: PRODUCT,
    } as const

    // when
    const enabled = isTelemetryClientEnabled(input)

    // then
    expect(enabled).toBe(false)
  })

  test("#given a first-run answer written to the canonical path #when the file is inspected #then it is readable only by its owner", () => {
    // given
    const home = mkdtempSync(join(tmpdir(), "omo-pr-b-firstrun-"))
    consentRoots.push(home)
    const stateFilePath = resolveTelemetryConsentStatePath({ env: { HOME: home } })

    // when
    const written = writeTelemetryConsentState(stateFilePath, { enabled: true })

    // then
    expect(written).toBe(true)
    expect(stateFilePath).toBe(join(home, ".omo", "state", "telemetry.json"))
    expect(statSync(stateFilePath).mode & 0o777).toBe(TELEMETRY_CONSENT_FILE_MODE)
  })

  test("#given a canonical answer file #when it is read back #then it names the answer that was written", () => {
    // given
    const home = mkdtempSync(join(tmpdir(), "omo-pr-b-readback-"))
    consentRoots.push(home)
    const stateFilePath = resolveTelemetryConsentStatePath({ env: { HOME: home } })

    // when
    writeTelemetryConsentState(stateFilePath, { enabled: false })

    // then
    expect(readTelemetryConsentState(stateFilePath)).toEqual({
      enabled: false,
      version: 1,
      answered_at: expect.any(String),
    })
  })

  test("#given an answer file that cannot be parsed #when it is read #then it reads as unanswered", () => {
    // given
    const stateFilePath = consentStatePath()
    writeFileSync(stateFilePath, "{ not json")

    // when
    const state = readTelemetryConsentState(stateFilePath)

    // then
    expect(state).toBeUndefined()
    expect(isTelemetryClientEnabled({ consentStatePath: stateFilePath, env: {}, product: PRODUCT })).toBe(false)
  })

  test("#given an answer file without an enabled field #when it is read #then it reads as unanswered", () => {
    // given
    const stateFilePath = consentStatePath()
    writeFileSync(stateFilePath, JSON.stringify({ version: 1 }))

    // when
    const state = readTelemetryConsentState(stateFilePath)

    // then
    expect(state).toBeUndefined()
  })

  test("#given the canonical path resolution #when no override is set #then the answer lives under the omo state directory", () => {
    // given
    const home = mkdtempSync(join(tmpdir(), "omo-pr-b-home-"))
    consentRoots.push(home)

    // when
    const stateFilePath = resolveTelemetryConsentStatePath({ env: { HOME: home } })

    // then
    expect(stateFilePath).toBe(join(home, ".omo", "state", "telemetry.json"))
  })

  test("#given a persisted on answer #when a client is created #then the transport is constructed", () => {
    // given
    const stateFilePath = consentStatePath()
    writeTelemetryConsentState(stateFilePath, { enabled: true })
    let transportsCreated = 0

    // when
    const client = createTelemetryClient({
      consentStatePath: stateFilePath,
      env: { POSTHOG_API_KEY: "test-key" },
      osProvider: OS_PROVIDER,
      product: PRODUCT,
      source: "cli",
      transportFactory: () => {
        transportsCreated += 1
        return { capture: () => undefined, shutdown: async () => undefined }
      },
    })

    // then
    expect(client.enabled).toBe(true)
    expect(transportsCreated).toBe(1)
  })

  test("#given no answered consent file #when a client is created #then the transport is never constructed", () => {
    // given
    let transportsCreated = 0

    // when
    const client = createTelemetryClient({
      consentStatePath: consentStatePath(),
      env: { POSTHOG_API_KEY: "test-key" },
      osProvider: OS_PROVIDER,
      product: PRODUCT,
      source: "cli",
      transportFactory: () => {
        transportsCreated += 1
        return { capture: () => undefined, shutdown: async () => undefined }
      },
    })

    // then
    expect(client.enabled).toBe(false)
    expect(transportsCreated).toBe(0)
  })
})

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

  test("#given the placeholder default and a real env override #when enabled state is checked #then telemetry stays disabled without a force-on flag", () => {
    expect(isTelemetryClientEnabled({
      env: { POSTHOG_API_KEY: "phc_test" },
      product: {
        defaultApiKey: UNCONFIGURED_POSTHOG_API_KEY,
        productEnvPrefix: "OMO_SENPI",
      },
    })).toBe(false)
  })

  test("#given the placeholder default and a real env override #when a force-on flag is set #then telemetry is enabled", () => {
    expect(isTelemetryClientEnabled({
      env: { OMO_SEND_ANONYMOUS_TELEMETRY: "1", POSTHOG_API_KEY: "phc_test" },
      product: {
        defaultApiKey: UNCONFIGURED_POSTHOG_API_KEY,
        productEnvPrefix: "OMO_SENPI",
      },
    })).toBe(true)
  })

  test("#given the legacy shared key as the default #when enabled state is checked #then telemetry stays disabled", () => {
    expect(isTelemetryClientEnabled({
      env: {},
      product: PRODUCT,
    })).toBe(false)
  })

  test("#given a real OmO Native default replaces the placeholder #when enabled state is checked #then telemetry still needs a force-on flag", () => {
    expect(isTelemetryClientEnabled({
      env: {},
      product: {
        defaultApiKey: "phc_omo_native_project_key",
        productEnvPrefix: "OMO_SENPI",
      },
    })).toBe(false)
  })

  test("#given codex product parameters #when daily active is captured #then payload shape matches current contract", async () => {
    // given
    const capturedMessages: TelemetryCaptureMessage[] = []
    const client = createTelemetryClient({
      consentStatePath: consentStatePath(),
      env: { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "1", POSTHOG_API_KEY: "test-key", POSTHOG_HOST: "https://posthog.test" },
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
        consentStatePath: consentStatePath(),
        env: { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "1", POSTHOG_API_KEY: "test-key" },
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
      consentStatePath: consentStatePath(),
      env: { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "1", POSTHOG_API_KEY: " " },
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
        consentStatePath: consentStatePath(),
        env: { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "1", POSTHOG_API_KEY: " " },
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
