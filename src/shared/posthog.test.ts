import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

type CapturedPostHogMessage = {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
}

async function importPostHogModule(): Promise<typeof import("./posthog")> {
  return import(`./posthog?test=${Date.now()}-${Math.random()}`)
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

function mockPostHogNode(capturedMessages: CapturedPostHogMessage[]): void {
  mock.module("posthog-node", () => ({
    PostHog: class {
      capture(message: CapturedPostHogMessage): void {
        capturedMessages.push(message)
      }
      async shutdown(): Promise<void> {}
    },
  }))
}

describe("posthog client creation", () => {
  beforeEach(() => {
    mock.restore()
    clearTelemetryEnv()
  })

  afterEach(() => {
    mock.restore()
    clearTelemetryEnv()
  })

  it("returns a no-op client when PostHog construction throws", async () => {
    // given
    enableTelemetryEnv()

    mock.module("posthog-node", () => ({
      PostHog: class {
        constructor() {
          throw new Error("posthog init failed")
        }
      },
    }))

    const { createCliPostHog, createPluginPostHog } = await importPostHogModule()

    // when
    const cliPostHog = createCliPostHog()
    const pluginPostHog = createPluginPostHog()

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

    mock.module("posthog-node", () => ({
      PostHog: class {
        capture() {}
        async shutdown() {}
      },
    }))

    const posthogModule = await importPostHogModule()
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
    posthogModule.__resetOsProviderForTesting()
  })

  it("passes the strict PostHog constructor options for both clients", async () => {
    // given
    enableTelemetryEnv()
    const capturedOptions: Array<Record<string, unknown>> = []

    mock.module("posthog-node", () => ({
      PostHog: class {
        constructor(_apiKey: string, options: Record<string, unknown>) {
          capturedOptions.push(options)
        }
        capture() {}
        async shutdown() {}
      },
    }))

    const { createCliPostHog, createPluginPostHog } = await importPostHogModule()

    // when
    createCliPostHog()
    createPluginPostHog()

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
})

describe("posthog trackActive emission contract", () => {
  let resetActivityStateProvider: (() => void) | null = null

  beforeEach(() => {
    mock.restore()
    clearTelemetryEnv()
  })

  afterEach(() => {
    resetActivityStateProvider?.()
    resetActivityStateProvider = null
    mock.restore()
    clearTelemetryEnv()
  })

  it("emits exactly one omo_daily_active and never omo_hourly_active when captureDaily is true", async () => {
    // given
    enableTelemetryEnv()
    const captured: CapturedPostHogMessage[] = []
    mockPostHogNode(captured)
    const posthogModule = await importPostHogModule()
    posthogModule.__setActivityStateProviderForTesting(() => ({
      dayUTC: "2026-04-18",
      captureDaily: true,
    }))
    resetActivityStateProvider = posthogModule.__resetActivityStateProviderForTesting
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
    expect(dailyEvent.properties?.day_utc).toBe("2026-04-18")
    expect(dailyEvent.properties?.reason).toBe("run_started")
    expect(dailyEvent.properties?.source).toBe("cli")
    expect(dailyEvent.properties?.$process_person_profile).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(dailyEvent.properties ?? {}, "hour_utc")).toBe(false)
  })

  it("emits nothing and never omo_hourly_active when captureDaily is false", async () => {
    // given
    enableTelemetryEnv()
    const captured: CapturedPostHogMessage[] = []
    mockPostHogNode(captured)
    const posthogModule = await importPostHogModule()
    posthogModule.__setActivityStateProviderForTesting(() => ({
      dayUTC: "2026-04-18",
      captureDaily: false,
    }))
    resetActivityStateProvider = posthogModule.__resetActivityStateProviderForTesting
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
