import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import type { TelemetryCaptureMessage } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "../../extension/compose"
import { omoSenpiComponents } from "../../extension/index"
import { createOmoNativeTelemetryComponent } from "./omo-native-component"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS } from "./product-identity"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  createTransportRecorder,
  withTempAgentDir,
} from "./telemetry.test-support"

const SHARED_KEYS = [
  "$process_person_profile",
  "package_version",
  "platform",
  "product_name",
  "schema_version",
] as const

function context(sessionId: string): Record<string, unknown> {
  return {
    cwd: "/repo",
    sessionManager: { getSessionId: () => sessionId },
  }
}

function writeInventory(agentDir: string): void {
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({
    providers: { openai: { models: [{ id: "gpt-5.6-sol" }] } },
  }))
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "openai",
    defaultModel: "gpt-5.6-sol",
  }))
}

function turnEnd(): Record<string, unknown> {
  return {
    type: "turn_end",
    turnIndex: 1,
    message: {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.6-sol",
      usage: {
        input: 11,
        output: 22,
        cacheRead: 3,
        cacheWrite: 4,
        reasoning: 5,
        totalTokens: 40,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0.04, total: 0.123456 },
      },
      stopReason: "stop",
      timestamp: 1,
    },
    toolResults: [],
  }
}

function toolResult(): Record<string, unknown> {
  return {
    type: "tool_result",
    toolCallId: "call-1",
    toolName: "create_goal",
    input: {},
    content: [],
    isError: false,
  }
}

function nativeMessages(messages: readonly TelemetryCaptureMessage[]): TelemetryCaptureMessage[] {
  return messages.filter(({ event }) => event !== "omo_senpi_daily_active")
}

function assertAllowlistedPayloadKeys(messages: readonly TelemetryCaptureMessage[]): void {
  for (const message of nativeMessages(messages)) {
    const event = message.event as keyof typeof OMO_NATIVE_PROPERTY_ALLOWLISTS
    expect(Object.keys(message.properties ?? {}).sort()).toEqual([
      ...OMO_NATIVE_PROPERTY_ALLOWLISTS[event],
      ...SHARED_KEYS,
    ].sort())
  }
}

describe("OmO Native telemetry component integration", () => {
  test("#given the real component list #when composed #then telemetry input classification registers before ultrawork", () => {
    const names = omoSenpiComponents.map(({ name }) => name)

    expect(names.indexOf("telemetry")).toBeGreaterThanOrEqual(0)
    expect(names.indexOf("telemetry")).toBeLessThan(names.indexOf("ultrawork"))
    expect(names.filter((name) => name === "telemetry")).toHaveLength(1)
  })

  test("#given an enabled composed component #when the full host sequence dispatches #then the exact event stream is captured in order", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      const session = context("integration-session")
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const component = createOmoNativeTelemetryComponent({
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("integration-host"),
        stateDir,
        transportFactory: recorder.factory,
      })
      component.register(pi, { config: pi, logger: createSilentLogger() })

      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
      await pi.dispatch("input", {
        type: "input",
        inputId: "input-1",
        text: "ulw plan",
        source: "interactive",
      }, session)
      await pi.dispatch("input_disposition", {
        type: "input_disposition",
        inputId: "input-1",
        disposition: "started",
      }, session)
      await pi.dispatch("turn_end", turnEnd(), session)
      await pi.dispatch("tool_result", toolResult(), session)
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)

      expect(recorder.messages.map(({ event }) => event)).toEqual([
        "daily_active",
        "session_started",
        "omo_senpi_daily_active",
        "prompt_submitted",
        "turn_completed",
        "feature_used",
      ])
      expect(nativeMessages(recorder.messages).map(({ properties }) => Object.keys(properties ?? {}).sort())).toEqual([
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.daily_active, ...SHARED_KEYS].sort(),
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.session_started, ...SHARED_KEYS].sort(),
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.prompt_submitted, ...SHARED_KEYS].sort(),
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.turn_completed, ...SHARED_KEYS].sort(),
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.feature_used, ...SHARED_KEYS].sort(),
      ])
      assertAllowlistedPayloadKeys(recorder.messages)
      expect(existsSync(join(stateDir, "last-payloads.json"))).toBe(false)
    })
  })

  test("#given the telemetry disable flag #when the full component is composed #then native and legacy capture zero events", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      pi.setFlag("omo-senpi-telemetry-disabled", true)

      await composeOmoSenpiExtension([
        createOmoNativeTelemetryComponent({
          env: createEnabledEnv(agentDir),
          hashSessionId: (raw) => `hashed:${raw}`,
          isConfigEnabled: () => true,
          now: FIXED_NOW,
          osProvider: createOsProvider("disabled-host"),
          stateDir: join(agentDir, "omo-senpi", "omo-native"),
          transportFactory: recorder.factory,
        }),
      ], { logger: createSilentLogger() })(pi)
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("disabled"))

      expect(recorder.messages).toEqual([])
    })
  })

  test("#given the real component registration order #when a session with overlapping tool calls shuts down #then exactly one non-empty parallelism_summary is captured", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      const session = context("ordering-session")
      createOmoNativeTelemetryComponent({
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("ordering-host"),
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })

      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
      await pi.dispatch("tool_execution_start", { type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: {} }, session)
      await pi.dispatch("tool_execution_start", { type: "tool_execution_start", toolCallId: "b", toolName: "read", args: {} }, session)
      await pi.dispatch("tool_execution_end", { type: "tool_execution_end", toolCallId: "a", toolName: "bash", result: 1, isError: false }, session)
      await pi.dispatch("tool_execution_end", { type: "tool_execution_end", toolCallId: "b", toolName: "read", result: 1, isError: false }, session)
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)

      // This is the ordering criterion: an emission registered after the session component would
      // capture zero events here while every injected-transport unit test stayed green.
      const summaries = recorder.messages.filter(({ event }) => event === "parallelism_summary")
      expect(summaries).toHaveLength(1)
      expect(summaries[0]?.properties).toMatchObject({
        $session_id: "hashed:ordering-session",
        non_eval_waves_total: 1,
        non_eval_joined_calls: 2,
        schema_kind: "parallelism_v2",
      })
      expect(Object.keys(summaries[0]?.properties ?? {}).sort()).toEqual(
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.parallelism_summary, ...SHARED_KEYS].sort(),
      )
      expect(recorder.messages.filter(({ event }) => event === "turn_completed")).toHaveLength(0)
    })
  })

  test("#given shutdown and restart plus repeated interruption #when sessions cycle #then client state is fresh and shutdown never throws", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      createOmoNativeTelemetryComponent({
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("restart-host"),
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })

      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("first"))
      await expect(pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context("first"))).resolves.toBeDefined()
      await pi.dispatch("session_start", { type: "session_start", reason: "new" }, context("second"))
      await pi.dispatch("input", {
        type: "input",
        inputId: "interrupted",
        text: "ordinary prompt",
        source: "interactive",
      }, context("second"))
      await expect(pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context("second"))).resolves.toBeDefined()
      await expect(pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context("second"))).resolves.toBeDefined()

      expect(nativeMessages(recorder.messages).filter(({ event }) => event === "session_started").map(({ properties }) => properties?.$session_id)).toEqual([
        "hashed:first",
        "hashed:second",
      ])
      expect(nativeMessages(recorder.messages).filter(({ event }) => event === "prompt_submitted")).toHaveLength(1)
    })
  })
})
