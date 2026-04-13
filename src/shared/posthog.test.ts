import { afterEach, describe, expect, it, mock } from "bun:test"

async function importPostHogModule(): Promise<typeof import("./posthog")> {
  return import(`./posthog?test=${Date.now()}-${Math.random()}`)
}

describe("posthog client creation", () => {
  afterEach(() => {
    mock.restore()
    delete process.env.OMO_DISABLE_POSTHOG
    delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
    delete process.env.POSTHOG_API_KEY
    delete process.env.POSTHOG_HOST
  })

  it("returns a no-op client when PostHog construction throws", async () => {
    // given
    process.env.OMO_DISABLE_POSTHOG = "0"
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "1"
    process.env.POSTHOG_API_KEY = "test-api-key"

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
})
