import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type {
  TelemetryCaptureMessage,
  TelemetryTransportFactory,
  TelemetryTransportOptions,
} from "@oh-my-opencode/telemetry-core"

type CapturedPostHogMessage = TelemetryCaptureMessage
type PostHogModule = Awaited<ReturnType<typeof importPostHogModule>>

let activePostHogModule: PostHogModule | null = null

async function importPostHogModule(): Promise<typeof import("./posthog")> {
  return import(`./posthog?test=${Date.now()}-${Math.random()}`)
}

function usePostHogModule(posthogModule: PostHogModule): PostHogModule {
  activePostHogModule = posthogModule
  return posthogModule
}

function resetPostHogModuleTestSeams(): void {
  activePostHogModule?.__resetActivityStateProviderForTesting()
  activePostHogModule?.__resetOsProviderForTesting()
  activePostHogModule?.__resetTransportFactoryForTesting()
  activePostHogModule = null
}

function enableTelemetryEnv(): void {
  process.env.OMO_DISABLE_POSTHOG = "0"
  process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "1"
  process.env.POSTHOG_API_KEY = "test-api-key"
}

function clearTelemetryEnv(): void {
  delete process.env.OMO_DISABLE_POSTHOG
  delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
  delete process.env.POSTHOG_API_KEY
  delete process.env.POSTHOG_HOST
}

function createCapturingTransportFactory(
  capturedMessages: CapturedPostHogMessage[],
  capturedOptions: TelemetryTransportOptions[] = [],
): TelemetryTransportFactory {
  return (_apiKey, options) => {
    capturedOptions.push(options)
    return {
      capture: (message) => {
        capturedMessages.push(message)
      },
      shutdown: async () => undefined,
    }
  }
}

describe("posthog client creation", () => {
  beforeEach(() => {
    clearTelemetryEnv()
  })

  afterEach(() => {
    resetPostHogModuleTestSeams()
    clearTelemetryEnv()
  })

  it("returns a no-op client when PostHog construction throws", async () => {
    // given
    enableTelemetryEnv()

    const posthogModule = usePostHogModule(await importPostHogModule())
    posthogModule.__setTransportFactoryForTesting(() => {
      throw new Error("posthog init failed")
    })

    // when
    const cliPostHog = posthogModule.createCliPostHog()
    const pluginPostHog = posthogModule.createPluginPostHog()

    // then
    expect(() => cliPostHog.trackActive("cli", "run_started")).not.toThrow()
    expect(await cliPostHog.shutdown()).toBeUndefined()

    expect(() => pluginPostHog.trackActive("plugin", "run_started")).not.toThrow()
    expect(await pluginPostHog.shutdown()).toBeUndefined()
  })

  it("creates a plugin client when os.cpus throws", async () => {
    // given
    process.env.OMO_DISABLE_POSTHOG = "0"
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "1"
    process.env.POSTHOG_API_KEY = "test-api-key"

    const posthogModule = usePostHogModule(await importPostHogModule())
    posthogModule.__setTransportFactoryForTesting(createCapturingTransportFactory([]))
    posthogModule.__setOsProviderForTesting({
      arch: () => "x64",
      cpus: () => {
        throw new Error("Failed to get CPU information")
      },
      hostname: () => "test-host",
      platform: () => "linux",
      release: () => "6.8.0-arch1-1",
      totalmem: () => 8 * 1024 * 1024 * 1024,
      type: () => "Linux",
    })

    // when
    const pluginPostHog = posthogModule.createPluginPostHog()

    // then
    expect(() => pluginPostHog.trackActive("plugin", "run_started")).not.toThrow()
    expect(await pluginPostHog.shutdown()).toBeUndefined()
  })

  it("passes the strict PostHog constructor options for both clients", async () => {
    // given
    enableTelemetryEnv()
    const capturedOptions: TelemetryTransportOptions[] = []

    const posthogModule = usePostHogModule(await importPostHogModule())
    posthogModule.__setTransportFactoryForTesting(
      createCapturingTransportFactory([], capturedOptions),
    )

    // when
    posthogModule.createCliPostHog()
    posthogModule.createPluginPostHog()

    // then
    expect(capturedOptions).toHaveLength(2)
    for (const options of capturedOptions) {
      expect(options).toMatchObject({
        enableExceptionAutocapture: false,
        enableLocalEvaluation: false,
        strictLocalEvaluation: true,
        disableRemoteConfig: true,
        flushAt: 1,
        flushInterval: 0,
      })
    }
  })

  it("constructs clients through the configured telemetry transport", async () => {
    // given
    enableTelemetryEnv()
    const capturedOptions: TelemetryTransportOptions[] = []
    const posthogModule = usePostHogModule(await importPostHogModule())
    posthogModule.__setTransportFactoryForTesting(
      createCapturingTransportFactory([], capturedOptions),
    )

    // when
    posthogModule.createCliPostHog()
    posthogModule.createPluginPostHog()

    // then
    expect(capturedOptions).toHaveLength(2)
  })
})

describe("posthog disable env var parsing", () => {
  beforeEach(() => {
    clearTelemetryEnv()
  })

  afterEach(() => {
    resetPostHogModuleTestSeams()
    clearTelemetryEnv()
  })

  const disableValues = ["TRUE", "True", "Yes", "YES", " 1 ", " true "]

  for (const value of disableValues) {
    it(`treats OMO_DISABLE_POSTHOG=${JSON.stringify(value)} as disabled`, async () => {
      // given
      process.env.OMO_DISABLE_POSTHOG = value
      process.env.POSTHOG_API_KEY = "test-api-key"
      const captured: CapturedPostHogMessage[] = []
      const posthogModule = usePostHogModule(await importPostHogModule())
      posthogModule.__setTransportFactoryForTesting(createCapturingTransportFactory(captured))
      posthogModule.__setActivityStateProviderForTesting(() => ({
        dayUTC: "2026-04-18",
        captureDaily: true,
      }))
      const client = posthogModule.createCliPostHog()

      // when
      client.trackActive("distinct-cli", "run_started")

      // then
      expect(captured).toHaveLength(0)
    })
  }

  const sendFalsyValues = ["NO", "No", "FALSE", "False", " 0 "]

  for (const value of sendFalsyValues) {
    it(`treats OMO_SEND_ANONYMOUS_TELEMETRY=${JSON.stringify(value)} as disabled`, async () => {
      // given
      process.env.OMO_SEND_ANONYMOUS_TELEMETRY = value
      process.env.POSTHOG_API_KEY = "test-api-key"
      const captured: CapturedPostHogMessage[] = []
      const posthogModule = usePostHogModule(await importPostHogModule())
      posthogModule.__setTransportFactoryForTesting(createCapturingTransportFactory(captured))
      posthogModule.__setActivityStateProviderForTesting(() => ({
        dayUTC: "2026-04-18",
        captureDaily: true,
      }))
      const client = posthogModule.createCliPostHog()

      // when
      client.trackActive("distinct-cli", "run_started")

      // then
      expect(captured).toHaveLength(0)
    })
  }
})

describe("posthog trackActive emission contract", () => {
  beforeEach(() => {
    clearTelemetryEnv()
  })

  afterEach(() => {
    resetPostHogModuleTestSeams()
    clearTelemetryEnv()
  })

  it("emits exactly one omo_daily_active and never omo_hourly_active when captureDaily is true", async () => {
    // given
    enableTelemetryEnv()
    const captured: CapturedPostHogMessage[] = []
    const posthogModule = usePostHogModule(await importPostHogModule())
    posthogModule.__setTransportFactoryForTesting(createCapturingTransportFactory(captured))
    posthogModule.__setOsProviderForTesting({
      arch: () => "arm64",
      cpus: () => [{ model: "Test CPU" }],
      hostname: () => "test-host",
      platform: () => "linux",
      release: () => "6.8.0-test",
      totalmem: () => 16 * 1024 * 1024 * 1024,
      type: () => "Linux",
    })
    posthogModule.__setActivityStateProviderForTesting(() => ({
      dayUTC: "2026-04-18",
      captureDaily: true,
    }))
    const client = posthogModule.createCliPostHog()

    // when
    client.trackActive("distinct-cli", "run_started")

    // then
    expect(captured).toHaveLength(1)
    const emittedEvents = captured.map((message) => message.event)
    expect(emittedEvents).not.toContain("omo_hourly_active")
    const [dailyEvent] = captured
    if (!dailyEvent) {
      throw new Error("Expected daily event")
    }
    expect(dailyEvent?.event).toBe("omo_daily_active")
    expect(dailyEvent?.distinctId).toBe("distinct-cli")
    const properties = dailyEvent.properties ?? {}
    const expectedPropertyKeys = ["$os", "$os_version", "$process_person_profile", "ci", "cpu_count", "cpu_model", "day_utc", "locale", "os_arch", "os_type", "package_name", "package_version", "platform", "plugin_name", "reason", "runtime", "runtime_version", "shell", "source", "terminal", "timezone", "total_memory_gb"]
    expect(Object.keys(properties).sort()).toEqual(expectedPropertyKeys.sort())
    expect(properties).toMatchObject({
      platform: "oh-my-opencode",
      package_name: "oh-my-openagent",
      plugin_name: "oh-my-openagent",
      source: "cli",
      $os: "linux",
      $os_version: "6.8.0-test",
      os_arch: "arm64",
      os_type: "Linux",
      cpu_count: 1,
      cpu_model: "Test CPU",
      total_memory_gb: 16,
      $process_person_profile: false,
      day_utc: "2026-04-18",
      reason: "run_started",
    })
  })

  it("emits nothing and never omo_hourly_active when captureDaily is false", async () => {
    // given
    enableTelemetryEnv()
    const captured: CapturedPostHogMessage[] = []
    const posthogModule = usePostHogModule(await importPostHogModule())
    posthogModule.__setTransportFactoryForTesting(createCapturingTransportFactory(captured))
    posthogModule.__setActivityStateProviderForTesting(() => ({
      dayUTC: "2026-04-18",
      captureDaily: false,
    }))
    const client = posthogModule.createPluginPostHog()

    // when
    client.trackActive("distinct-plugin", "run_started")

    // then
    expect(captured).toHaveLength(0)
    const emittedEvents = captured.map((message) => message.event)
    expect(emittedEvents).not.toContain("omo_daily_active")
    expect(emittedEvents).not.toContain("omo_hourly_active")
  })
})
