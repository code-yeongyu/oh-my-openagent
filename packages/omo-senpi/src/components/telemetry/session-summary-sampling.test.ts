import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createOmoNativeTelemetryComponent } from "./omo-native-component"
import { RAW_TURN_SAMPLE_RATE, RAW_TURN_SAMPLE_RATE_ENV, resolveRawTurnSampleRate } from "./session-summary-sampling"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  createTransportRecorder,
  withTempAgentDir,
} from "./telemetry.test-support"

// Config contract (plan todo 8 (g)): on the direct PostHog path the raw-turn rate is the env override, else
// `telemetry.rawTurnSampleRate`, else 0.05; when the sink is the collector the rate is always 1.

describe("raw-turn sample rate resolution", () => {
  test.each([
    ["posthog", undefined, {}, RAW_TURN_SAMPLE_RATE],
    ["posthog", 0.5, {}, 0.5],
    ["posthog", 0.5, { [RAW_TURN_SAMPLE_RATE_ENV]: "0.25" }, 0.25],
    ["posthog", 0.5, { [RAW_TURN_SAMPLE_RATE_ENV]: "2" }, 0.5],
    ["posthog", 7, { [RAW_TURN_SAMPLE_RATE_ENV]: "not-a-number" }, RAW_TURN_SAMPLE_RATE],
    ["collector", 0.05, {}, 1],
    ["collector", 0.05, { [RAW_TURN_SAMPLE_RATE_ENV]: "0" }, 1],
  ] as const)("#given sink %s, config %p and env %p #when resolved #then the rate is %p", (sink, configured, env, expected) => {
    expect(resolveRawTurnSampleRate({ sink, ...(configured === undefined ? {} : { configured }), env })).toBe(expected)
  })
})

describe("raw-turn sample rate wiring through the component", () => {
  async function sampleRateSeen(input: { readonly omoJson?: unknown; readonly env?: Record<string, string> }): Promise<unknown> {
    return withTempAgentDir(async (agentDir) => {
      const home = join(agentDir, "home")
      mkdirSync(join(home, ".omo"), { recursive: true })
      if (input.omoJson !== undefined) writeFileSync(join(home, ".omo", "omo.json"), JSON.stringify(input.omoJson))
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      const session = { cwd: home, sessionManager: { getSessionId: () => "rate-session" } }
      createOmoNativeTelemetryComponent({
        env: { ...createEnabledEnv(agentDir), HOME: home, ...input.env },
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("rate-host"),
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
      await pi.dispatch("turn_end", {
        type: "turn_end",
        turnIndex: 0,
        message: { role: "assistant", content: [], provider: "openai", model: "gpt-5.6-sol", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } }, stopReason: "stop", timestamp: 1 },
        toolResults: [],
      }, session)
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)
      return recorder.messages.find(({ event }) => event === "session_summary")?.properties?.["sample_rate"]
    })
  }

  test("#given no config #when a session reports #then the direct-path default 0.05 applies", async () => {
    expect(await sampleRateSeen({})).toBe(RAW_TURN_SAMPLE_RATE)
  })

  test("#given telemetry.rawTurnSampleRate in omo.json #when a session reports #then the configured rate applies", async () => {
    expect(await sampleRateSeen({ omoJson: { telemetry: { rawTurnSampleRate: 0.5 } } })).toBe(0.5)
  })

  test("#given the env override and a config value #when a session reports #then the env override wins", async () => {
    expect(await sampleRateSeen({ omoJson: { telemetry: { rawTurnSampleRate: 0.5 } }, env: { [RAW_TURN_SAMPLE_RATE_ENV]: "1" } })).toBe(1)
  })
})
