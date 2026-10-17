/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type {
  TelemetryCaptureMessage,
  TelemetryTransportFactory,
  TelemetryTransportOptions,
} from "@oh-my-opencode/telemetry-core"

type PostHogModule = Awaited<ReturnType<typeof importPostHogModule>>

type TransportCalls = {
  readonly captured: TelemetryCaptureMessage[]
  readonly options: TelemetryTransportOptions[]
  flushCount: number
  shutdownCount: number
}

let activePostHogModule: PostHogModule | null = null
const originalConsoleError = console.error

async function importPostHogModule(): Promise<typeof import("./posthog")> {
  return import(`./posthog?test=${Date.now()}-${Math.random()}`)
}

async function loadPostHogModule(): Promise<PostHogModule> {
  const posthogModule = await importPostHogModule()
  activePostHogModule = posthogModule
  posthogModule.__setActivityStateProviderForTesting(() => ({
    dayUTC: "2026-09-24",
    captureDaily: true,
  }))
  return posthogModule
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

function createRecordingTransportFactory(calls: TransportCalls): TelemetryTransportFactory {
  return (_apiKey, options) => {
    calls.options.push(options)
    return {
      capture: (message) => {
        calls.captured.push(message)
      },
      flush: async () => {
        calls.flushCount++
      },
      shutdown: async () => {
        calls.shutdownCount++
      },
    }
  }
}

function createTransportCalls(): TransportCalls {
  return { captured: [], options: [], flushCount: 0, shutdownCount: 0 }
}

describe("plugin load telemetry send path", () => {
  beforeEach(() => {
    clearTelemetryEnv()
  })

  afterEach(() => {
    console.error = originalConsoleError
    activePostHogModule?.__resetActivityStateProviderForTesting()
    activePostHogModule?.__resetTransportFactoryForTesting()
    activePostHogModule = null
    clearTelemetryEnv()
  })

  it("#given plugin load #when telemetry is recorded #then it flushes and never shuts the client down", async () => {
    // given
    enableTelemetryEnv()
    const calls = createTransportCalls()
    const posthogModule = await loadPostHogModule()
    posthogModule.__setTransportFactoryForTesting(createRecordingTransportFactory(calls))

    // when
    posthogModule.recordPluginTelemetry({ configEnabled: true })

    // then
    expect(calls.captured).toHaveLength(1)
    expect(calls.flushCount).toBe(1)
    expect(calls.shutdownCount).toBe(0)
  })

  it("#given the plugin client #when constructed #then capture does not start a background flush", async () => {
    // given
    enableTelemetryEnv()
    const calls = createTransportCalls()
    const posthogModule = await loadPostHogModule()
    posthogModule.__setTransportFactoryForTesting(createRecordingTransportFactory(calls))

    // when
    posthogModule.createPluginPostHog()
    posthogModule.createCliPostHog()

    // then
    const [pluginOptions, cliOptions] = calls.options
    expect(pluginOptions?.flushAt).toBeGreaterThan(1)
    expect(cliOptions?.flushAt).toBe(1)
  })

  it("#given a rejecting transport flush #when the plugin client flushes #then the failure resolves without throwing", async () => {
    // given
    enableTelemetryEnv()
    const posthogModule = await loadPostHogModule()
    posthogModule.__setTransportFactoryForTesting(() => ({
      capture: () => undefined,
      flush: async () => {
        throw new Error("socket connection was closed unexpectedly")
      },
      shutdown: async () => undefined,
    }))
    const client = posthogModule.createPluginPostHog()
    client.trackActive("distinct-plugin", "plugin_loaded")

    // when
    const flushed = client.flush()

    // then
    await expect(flushed).resolves.toBeUndefined()
  })

  it("#given a PostHog endpoint that rejects the batch #when the real plugin client flushes explicitly #then the failure is not printed to the console", async () => {
    // given
    enableTelemetryEnv()
    const batchRequests: string[] = []
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        batchRequests.push(new URL(request.url).pathname)
        return new Response("bad request", { status: 400 })
      },
    })
    process.env.POSTHOG_HOST = `http://127.0.0.1:${server.port}`
    const consoleError = mock((..._args: unknown[]) => {})
    console.error = consoleError
    const posthogModule = await loadPostHogModule()
    const client = posthogModule.createPluginPostHog()

    // when
    client.trackActive("distinct-plugin", "plugin_loaded")
    await client.flush()

    // then
    expect(batchRequests).toEqual(["/batch/"])
    expect(consoleError).not.toHaveBeenCalled()
  })
})
