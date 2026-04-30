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
      captureException(): void {}
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
    expect(() =>
      cliPostHog.capture({
        distinctId: "cli",
        event: "run_started",
      }),
    ).not.toThrow()
    expect(() => cliPostHog.captureException(new Error("cli failure"), "cli")).not.toThrow()
    expect(() => cliPostHog.trackActive("cli", "run_started")).not.toThrow()
    await expect(cliPostHog.shutdown()).resolves.toBeUndefined()

    expect(() =>
      pluginPostHog.capture({
        distinctId: "plugin",
        event: "plugin_loaded",
      }),
    ).not.toThrow()
    expect(() => pluginPostHog.captureException(new Error("plugin failure"), "plugin")).not.toThrow()
    expect(() => pluginPostHog.trackActive("plugin", "plugin_loaded")).not.toThrow()
    await expect(pluginPostHog.shutdown()).resolves.toBeUndefined()
  })

  it("creates a plugin client when os.cpus throws", async () => {
    // given
    process.env.OMO_DISABLE_POSTHOG = "0"
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "1"
    process.env.POSTHOG_API_KEY = "test-api-key"

    mock.module("os", () => ({
      default: {
        arch: () => "x64",
        cpus: () => {
          throw new Error("Failed to get CPU information")
        },
        hostname: () => "test-host",
        platform: () => "linux",
        release: () => "6.8.0-arch1-1",
        totalmem: () => 8 * 1024 * 1024 * 1024,
        type: () => "Linux",
      },
    }))

    mock.module("posthog-node", () => ({
      PostHog: class {
        capture() {}
        captureException() {}
        async shutdown() {}
      },
    }))

    const { createPluginPostHog } = await importPostHogModule()

    // when
    const pluginPostHog = createPluginPostHog()

    // then
    expect(() =>
      pluginPostHog.capture({
        distinctId: "plugin",
        event: "plugin_loaded",
      }),
    ).not.toThrow()
    expect(() => pluginPostHog.captureException(new Error("plugin failure"), "plugin")).not.toThrow()
    expect(() => pluginPostHog.trackActive("plugin", "plugin_loaded")).not.toThrow()
    await expect(pluginPostHog.shutdown()).resolves.toBeUndefined()
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
    expect(dailyEvent?.event).toBe("omo_daily_active")
    expect(dailyEvent?.distinctId).toBe("distinct-cli")
    expect(dailyEvent?.properties).toMatchObject({
      day_utc: "2026-04-18",
      reason: "run_started",
      source: "cli",
    })
    expect(dailyEvent?.properties).not.toHaveProperty("hour_utc")
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
    client.trackActive("distinct-plugin", "plugin_loaded")

    // then
    expect(captured).toHaveLength(0)
    const emittedEvents = captured.map((message) => message.event)
    expect(emittedEvents).not.toContain("omo_daily_active")
    expect(emittedEvents).not.toContain("omo_hourly_active")
  })
})
