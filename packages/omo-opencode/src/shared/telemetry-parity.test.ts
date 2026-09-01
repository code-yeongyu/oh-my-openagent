/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type {
  TelemetryCaptureMessage,
  TelemetryOsProvider,
  TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"
import {
  getTelemetryActivityStateFilePath,
  resolveTelemetryStateDir,
} from "@oh-my-opencode/telemetry-core"
import { createOpencodeTelemetryProductConfig } from "./telemetry-product-identity"

type CapturedPostHogMessage = TelemetryCaptureMessage
type PostHogModule = Awaited<ReturnType<typeof importPostHogModule>>

const EXPECTED_DISTINCT_ID_FOR_PARITY_HOST =
  "ad898a24f97bd14de34b9f3de62ab7cf1c2a77330ba41906af6e517f20e8272d"

let activePostHogModule: PostHogModule | null = null
const originalXdgDataHome = process.env.XDG_DATA_HOME

async function importPostHogModule(): Promise<typeof import("./posthog")> {
  return import(`./posthog?parity=${Date.now()}-${Math.random()}`)
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

function resetTelemetryEnv(): void {
  delete process.env.OMO_DISABLE_POSTHOG
  delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
  process.env.POSTHOG_API_KEY = "test-api-key"
}

function createCapturingTransportFactory(
  capturedMessages: CapturedPostHogMessage[],
): TelemetryTransportFactory {
  return () => ({
    capture: (message) => {
      capturedMessages.push(message)
    },
    shutdown: async () => undefined,
  })
}

function createParityOsProvider(hostname: string): TelemetryOsProvider {
  return {
    arch: () => "arm64",
    cpus: () => [{ model: "Parity CPU" }],
    hostname: () => hostname,
    platform: () => "darwin",
    release: () => "26.0.0",
    totalmem: () => 32 * 1024 * 1024 * 1024,
    type: () => "Darwin",
  }
}

async function captureWithEnv(
  envPatch: Readonly<Record<string, string | undefined>>,
): Promise<readonly CapturedPostHogMessage[]> {
  resetTelemetryEnv()
  for (const [key, value] of Object.entries(envPatch)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  const captured: CapturedPostHogMessage[] = []
  const posthogModule = usePostHogModule(await importPostHogModule())
  posthogModule.__setTransportFactoryForTesting(createCapturingTransportFactory(captured))
  posthogModule.__setActivityStateProviderForTesting(() => ({
    dayUTC: "2026-06-28",
    captureDaily: true,
  }))

  const client = posthogModule.createCliPostHog()
  client.trackActive("distinct-cli", "run_started")
  await client.shutdown()

  return captured
}

afterEach(() => {
  resetPostHogModuleTestSeams()
  delete process.env.OMO_DISABLE_POSTHOG
  delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
  delete process.env.POSTHOG_API_KEY
  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME
  } else {
    process.env.XDG_DATA_HOME = originalXdgDataHome
  }
})

describe("telemetry before/after parity", () => {
  it("pins event name, distinct ID prefix, state file path, env matrix, and payload keys", async () => {
    // given
    resetTelemetryEnv()
    const captured: CapturedPostHogMessage[] = []
    const xdgDataHome = join(tmpdir(), `telemetry-parity-${Date.now()}-${Math.random()}`)
    process.env.XDG_DATA_HOME = xdgDataHome
    const product = createOpencodeTelemetryProductConfig()
    const posthogModule = usePostHogModule(await importPostHogModule())
    posthogModule.__setTransportFactoryForTesting(createCapturingTransportFactory(captured))
    posthogModule.__setOsProviderForTesting(createParityOsProvider("telemetry-parity-host"))
    posthogModule.__setActivityStateProviderForTesting(() => ({
      dayUTC: "2026-06-28",
      captureDaily: true,
    }))
    const expectedStateFilePath = join(xdgDataHome, "oh-my-opencode", "posthog-activity.json")

    // when
    const distinctId = posthogModule.getPostHogDistinctId()
    const stateFilePath = getTelemetryActivityStateFilePath(resolveTelemetryStateDir(product))
    const client = posthogModule.createCliPostHog()
    client.trackActive(distinctId, "run_started")
    await client.shutdown()

    // then
    expect(product.eventName).toBe("omo_daily_active")
    expect(product.machineIdPrefix).toBe("oh-my-openagent:")
    expect(product.cacheDirName).toBe("oh-my-opencode")
    expect(distinctId).toBe(EXPECTED_DISTINCT_ID_FOR_PARITY_HOST)
    expect(stateFilePath).toBe(expectedStateFilePath)
    expect(existsSync(stateFilePath)).toBe(false)
    expect(captured).toHaveLength(1)
    const [dailyEvent] = captured
    if (!dailyEvent) {
      throw new Error("Expected telemetry parity event")
    }
    expect(dailyEvent.event).toBe("omo_daily_active")
    const payloadKeys = Object.keys(dailyEvent.properties ?? {}).sort()
    expect(payloadKeys).toContain("plugin_name")
    expect(payloadKeys).toContain("product_name")
  })

  it("preserves the legacy env opt-out matrix including yes as enabled", async () => {
    // given / when
    const disabledByPostHogFlag = await captureWithEnv({ OMO_DISABLE_POSTHOG: "1" })
    const disabledBySendZero = await captureWithEnv({ OMO_SEND_ANONYMOUS_TELEMETRY: "0" })
    const enabledBySendYes = await captureWithEnv({ OMO_SEND_ANONYMOUS_TELEMETRY: "yes" })
    const disabledBySendNo = await captureWithEnv({ OMO_SEND_ANONYMOUS_TELEMETRY: "no" })
    const enabledByUnset = await captureWithEnv({})

    // then
    expect(disabledByPostHogFlag).toHaveLength(0)
    expect(disabledBySendZero).toHaveLength(0)
    expect(enabledBySendYes).toHaveLength(1)
    expect(disabledBySendNo).toHaveLength(0)
    expect(enabledByUnset).toHaveLength(1)
  })
})
