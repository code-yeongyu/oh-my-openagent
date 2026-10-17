import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, spyOn, test } from "bun:test"

import type { TelemetryCaptureMessage } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "../../extension/compose"
import { omoSenpiComponents } from "../../extension/index"
import { createTaskTerminalObservers } from "../task/terminal-observers"
import { sharedKibitzerTelemetryObservers } from "../memory/kibitzer/wake-observers"
import type {
  ComputerUseTelemetryObservation,
  ComputerUseTelemetryObservers,
} from "./omo-native-computer-use"
import { CONSENT_CACHE_MS, createOmoNativeTelemetryComponent } from "./omo-native-component"
import * as parallelSummaryModule from "./omo-native-parallel-summary"
import { OMO_NATIVE_COMMON_PROPERTY_SCHEMAS, OMO_NATIVE_PROPERTY_ALLOWLISTS, OMO_NATIVE_SCHEMA_VERSION } from "./product-identity"
import { rollupDir } from "./session-summary-store"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  createTransportRecorder,
  withTempAgentDir,
} from "./telemetry.test-support"

const SHARED_KEYS = Object.keys(OMO_NATIVE_COMMON_PROPERTY_SCHEMAS)

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

// No process can hold this pid, so the real liveness probe reports its owner dead: exactly what a
// killed process leaves behind.
const DEAD_PID = 0x7fff_fff0

function rollupFiles(stateDir: string): string[] {
  return existsSync(rollupDir(stateDir)) ? readdirSync(rollupDir(stateDir)).filter((name) => name.endsWith(".json")) : []
}

function killWithoutShutdown(stateDir: string): void {
  for (const name of rollupFiles(stateDir)) {
    const path = join(rollupDir(stateDir), name)
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), pid: DEAD_PID }))
  }
}

function nativeMessages(messages: readonly TelemetryCaptureMessage[]): TelemetryCaptureMessage[] {
  return messages.filter(({ event }) => event !== "omo_senpi_daily_active")
}

function computerObservers(): {
  readonly registry: ComputerUseTelemetryObservers
  publish(observation: ComputerUseTelemetryObservation): void
} {
  let observer: ((observation: ComputerUseTelemetryObservation) => void) | undefined
  return {
    registry: {
      publish: (observation) => observer?.(observation),
      subscribe: (next) => {
        observer = next
        return () => {
          if (observer === next) observer = undefined
        }
      },
    },
    publish: (observation) => observer?.(observation),
  }
}

// Token totals and `cost_usd` are omitted by design when the provider never reported them, so a
// delegation row is checked for CONTAINMENT in its allowlist; every other event ships a fixed set.
function assertAllowlistedPayloadKeys(messages: readonly TelemetryCaptureMessage[]): void {
  for (const message of nativeMessages(messages)) {
    const event = message.event as keyof typeof OMO_NATIVE_PROPERTY_ALLOWLISTS
    const allowed: readonly string[] = [...OMO_NATIVE_PROPERTY_ALLOWLISTS[event], ...SHARED_KEYS].toSorted()
    const actual = Object.keys(message.properties ?? {}).sort()
    if (event === "delegation_completed") {
      expect(actual.filter((key) => !allowed.includes(key))).toEqual([])
      continue
    }
    expect(actual).toEqual([...allowed])
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
        rawTurnSampleRate: 1,
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
        "session_summary",
      ])
      expect(nativeMessages(recorder.messages).map(({ properties }) => Object.keys(properties ?? {}).sort())).toEqual([
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.daily_active, ...SHARED_KEYS].sort(),
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.session_started, ...SHARED_KEYS].sort(),
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.prompt_submitted, ...SHARED_KEYS].sort(),
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.turn_completed, ...SHARED_KEYS].sort(),
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.feature_used, ...SHARED_KEYS].sort(),
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.session_summary, ...SHARED_KEYS].sort(),
      ])
      assertAllowlistedPayloadKeys(recorder.messages)
      expect(existsSync(join(stateDir, "last-payloads.json"))).toBe(false)
    })
  })

  // Registration order is the whole contract here: the session component's `session_shutdown` handler
  // shuts the client down and clears `state.capture`, so a `kibitzer_summary` registered after it would
  // capture into a dead client and vanish with every test still green. Driving the REAL component is the
  // only way that failure is visible, which is why the parallelism summary is pinned the same way.
  test("#given a settled kibitzer wake #when the real component shuts the session down #then kibitzer_summary still reaches the transport", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      const session = context("kibitzer-order-session")
      const component = createOmoNativeTelemetryComponent({
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("integration-host"),
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        transportFactory: recorder.factory,
      })
      component.register(pi, { config: pi, logger: createSilentLogger() })

      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
      sharedKibitzerTelemetryObservers().notify({
        kind: "wake",
        sessionId: "kibitzer-order-session",
        wake: 1,
        generation: 1,
        status: "completed",
        nudges: 2,
        candidateCount: 3,
        toolCalls: 1,
        durationMs: 4_000,
        slotWaitMs: 50,
        usage: { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 },
      })
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)

      const summary = recorder.messages.find(({ event }) => event === "kibitzer_summary")
      expect(summary?.properties?.["nudges_delivered"]).toBe(2)
      expect(summary?.properties?.["$session_id"]).toBe("hashed:kibitzer-order-session")
      expect(Object.keys(summary?.properties ?? {}).sort()).toEqual(
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS.kibitzer_summary, ...SHARED_KEYS].sort(),
      )
      assertAllowlistedPayloadKeys(recorder.messages)
    })
  })

  // The summary carries the totals for sessions outside the raw sample, so it must reach the transport
  // at shutdown through the REAL registration order, and an unsampled session must send no raw turn.
  test("#given an unsampled session #when turns end and the session shuts down #then no turn_completed is sent and session_summary carries the totals", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      const session = context("unsampled-session")
      createOmoNativeTelemetryComponent({
        rawTurnSampleRate: 0,
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("summary-host"),
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })

      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
      await pi.dispatch("turn_end", turnEnd(), session)
      await pi.dispatch("turn_end", turnEnd(), session)
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)

      expect(recorder.messages.filter(({ event }) => event === "turn_completed")).toHaveLength(0)
      const summaries = recorder.messages.filter(({ event }) => event === "session_summary")
      expect(summaries).toHaveLength(1)
      expect(summaries[0]?.properties).toMatchObject({
        $session_id: "hashed:unsampled-session",
        turns: 2,
        is_final: true,
        raw_turns_sampled: false,
        sample_rate: 0,
      })
      assertAllowlistedPayloadKeys(recorder.messages)
    })
  })

  test("#given a task-child session #when it reports its summary #then session_role says child so delegated cost is not counted twice", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      const session = context("child-session")
      createOmoNativeTelemetryComponent({
        rawTurnSampleRate: 0,
        env: { ...createEnabledEnv(agentDir), OMO_SENPI_TASK_RPC_CHILD: "1" },
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("child-host"),
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })

      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
      await pi.dispatch("turn_end", turnEnd(), session)
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)

      expect(recorder.messages.find(({ event }) => event === "session_summary")?.properties).toMatchObject({ session_role: "child", turns: 1 })
    })
  })

  test("#given a delegation capture carrying a foreign $session_id #when forwarded #then state.sessionHash is unchanged and only session_start may set it", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given: a live session plus a terminal edge for a task spawned by an OLDER session
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      const session = context("live-session")
      const observers = createTaskTerminalObservers()
      createOmoNativeTelemetryComponent({
        rawTurnSampleRate: 1,
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("ownership-host"),
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        taskTerminalObservers: observers,
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)

      // when
      observers.notify({
        record: {
          task_id: "st_0001",
          status: "completed",
          residency_state: "resident",
          created_at: "2026-07-03T00:00:00.000Z",
          updated_at: "2026-07-03T00:00:01.000Z",
          parent_session_id: "older-session",
          root_session_id: "older-session",
          depth: 0,
          execution_mode: "in-process",
          model: "anthropic/claude-opus-5",
          notify_on_terminal: false,
          notification: { run_epoch: 0, notified_epoch: -1 },
          task_seq: 1,
          spawn_spec: { version: 1, cwd: "/repo", prompt: "work" },
        },
        previousStatus: "running",
      })
      await pi.dispatch("turn_end", turnEnd(), session)

      // then: the task row is hashed from the parent it belongs to, and the live session hash survives
      const delegation = recorder.messages.find(({ event }) => event === "delegation_completed")
      expect(delegation?.properties?.$session_id).toBe("hashed:older-session")
      expect(delegation?.properties?.schema_version).toBe(OMO_NATIVE_SCHEMA_VERSION)
      expect(recorder.messages.find(({ event }) => event === "turn_completed")?.properties?.$session_id).toBe("hashed:live-session")
      assertAllowlistedPayloadKeys(recorder.messages)
    })
  })

  test("#given a composed component that shut its session down #when a later terminal edge fires #then nothing is captured", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      const session = context("disposed-session")
      const observers = createTaskTerminalObservers()
      createOmoNativeTelemetryComponent({
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("dispose-host"),
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        taskTerminalObservers: observers,
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)

      // when
      observers.notify({
        record: {
          task_id: "st_0002",
          status: "completed",
          residency_state: "resident",
          created_at: "2026-07-03T00:00:00.000Z",
          updated_at: "2026-07-03T00:00:01.000Z",
          parent_session_id: "disposed-session",
          root_session_id: "disposed-session",
          depth: 0,
          execution_mode: "in-process",
          model: "anthropic/claude-opus-5",
          notify_on_terminal: false,
          notification: { run_epoch: 0, notified_epoch: -1 },
          task_seq: 1,
          spawn_spec: { version: 1, cwd: "/repo", prompt: "work" },
        },
        previousStatus: "running",
      })

      // then
      expect(recorder.messages.filter(({ event }) => event === "delegation_completed")).toEqual([])
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

  test("#given config telemetry opt-out #when computer use publishes #then its event also captures nothing", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = new FakeExtensionAPI()
      const computer = computerObservers()
      createOmoNativeTelemetryComponent({
        computerUseTelemetryObservers: computer.registry,
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => false,
        now: FIXED_NOW,
        osProvider: createOsProvider("disabled-host"),
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })

      // when
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("disabled"))
      computer.publish({
        kind: "activation",
        sessionId: "disabled",
        active: true,
        source: "tool_call",
        platform: "linux",
        backend: "x11",
      })

      // then
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

  // #10226 H1: every event the opted-out process sees must stop at the consent gate. Deriving a session
  // hash alone persists the hashing salt, so the gate has to hold before any hash is taken, not only
  // before a send.
  for (const [label, env] of [
    ["OMO_DISABLE_TELEMETRY=1", { OMO_DISABLE_TELEMETRY: "1" }],
    ["DO_NOT_TRACK=1", { DO_NOT_TRACK: "1" }],
  ] as const) {
    test(`#given an opted-out process (${label}) #when it sees every event kind and is killed #then it derives no session hash, writes no file, and the next enabled process sends nothing of it`, async () => {
      await withTempAgentDir(async (agentDir) => {
        writeInventory(agentDir)
        const stateDir = join(agentDir, "omo-senpi", "omo-native")
        const recorder = createTransportRecorder()
        const hashed: string[] = []
        const register = (extraEnv: Record<string, string>) => {
          const pi = new FakeExtensionAPI()
          createOmoNativeTelemetryComponent({
            rawTurnSampleRate: 1,
            env: { ...createEnabledEnv(agentDir), ...extraEnv },
            hashSessionId: (raw) => {
              hashed.push(raw)
              return `hashed:${raw}`
            },
            isConfigEnabled: () => true,
            now: FIXED_NOW,
            osProvider: createOsProvider("gate-host"),
            scheduleConsentCheck: () => () => undefined,
            stateDir,
            transportFactory: recorder.factory,
          }).register(pi, { config: pi, logger: createSilentLogger() })
          return pi
        }

        // given: the opted-out process runs a full turn cycle and dies without session_shutdown
        const optedOut = register(env)
        const session = context("opted-out")
        await optedOut.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
        await optedOut.dispatch("input", { type: "input", inputId: "input-1", text: "ulw plan", source: "interactive" }, session)
        await optedOut.dispatch("input_disposition", { type: "input_disposition", inputId: "input-1", disposition: "started" }, session)
        await optedOut.dispatch("turn_end", turnEnd(), session)
        await optedOut.dispatch("tool_result", toolResult(), session)
        await optedOut.dispatch("turn_end", turnEnd(), session)
        killWithoutShutdown(stateDir)

        // then: nothing was derived, written, or sent, not even the legacy daily-active ping
        expect(hashed).toEqual([])
        expect(existsSync(stateDir) ? readdirSync(stateDir, { recursive: true }) : []).toEqual([])
        expect(recorder.messages).toEqual([])

        // when: an enabled process starts, records a turn and quits
        const optedIn = register({})
        await optedIn.dispatch("session_start", { type: "session_start", reason: "startup" }, context("opted-in"))
        await optedIn.dispatch("turn_end", turnEnd(), context("opted-in"))
        await optedIn.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context("opted-in"))

        // then: only the enabled session reached the wire
        expect(nativeMessages(recorder.messages).filter(({ properties }) => properties?.$session_id === "hashed:opted-out")).toEqual([])
        expect(rollupFiles(stateDir)).toEqual([])
      })
    })
  }

  // #10229: opt-out used to silence only the opted-out process. Its rollup file still reached disk on
  // every turn, and the next opted-in process recovered it and sent it.
  for (const [label, optOut] of [
    ["DO_NOT_TRACK=1", { env: { DO_NOT_TRACK: "1" }, configEnabled: true }],
    ["OMO_DISABLE_TELEMETRY=1", { env: { OMO_DISABLE_TELEMETRY: "1" }, configEnabled: true }],
    ["config telemetry disabled", { env: {}, configEnabled: false }],
    ["OMO_DISABLE_POSTHOG=1", { env: { OMO_DISABLE_POSTHOG: "1" }, configEnabled: true }],
    ["OMO_SENPI_SEND_ANONYMOUS_TELEMETRY=0", { env: { OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: "0" }, configEnabled: true }],
  ] as const) {
    test(`#given an opted-out session (${label}) killed after two turns #when an opted-in session records a turn #then nothing of the opted-out session is sent or left on disk`, async () => {
      await withTempAgentDir(async (agentDir) => {
        writeInventory(agentDir)
        const stateDir = join(agentDir, "omo-senpi", "omo-native")
        const recorder = createTransportRecorder()
        const register = (env: Record<string, string>, configEnabled: boolean) => {
          const pi = new FakeExtensionAPI()
          createOmoNativeTelemetryComponent({
            rawTurnSampleRate: 0,
            env: { ...createEnabledEnv(agentDir), ...env },
            hashSessionId: (raw) => `hashed:${raw}`,
            isConfigEnabled: () => configEnabled,
            now: FIXED_NOW,
            osProvider: createOsProvider("optout-host"),
            stateDir,
            transportFactory: recorder.factory,
          }).register(pi, { config: pi, logger: createSilentLogger() })
          return pi
        }

        // given: session 1 is opted out, completes two turns and dies without session_shutdown
        const optedOut = register(optOut.env, optOut.configEnabled)
        await optedOut.dispatch("session_start", { type: "session_start", reason: "startup" }, context("opted-out"))
        await optedOut.dispatch("turn_end", turnEnd(), context("opted-out"))
        await optedOut.dispatch("turn_end", turnEnd(), context("opted-out"))
        killWithoutShutdown(stateDir)

        // when: a later opted-in process records one turn and quits
        const optedIn = register({}, true)
        await optedIn.dispatch("session_start", { type: "session_start", reason: "startup" }, context("opted-in"))
        await optedIn.dispatch("turn_end", turnEnd(), context("opted-in"))

        // then
        const summaries = recorder.messages.filter(({ event }) => event === "session_summary")
        expect(summaries.filter(({ properties }) => properties?.$session_id === "hashed:opted-out")).toEqual([])
        expect(rollupFiles(stateDir).filter((name) => name.includes("opted-out"))).toEqual([])
        await optedIn.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context("opted-in"))
        expect(recorder.messages.filter(({ event }) => event === "session_summary").map(({ properties }) => properties?.$session_id)).toEqual(["hashed:opted-in"])
      })
    })
  }

  test("#given a session that opts out mid-way #when its next turn ends and it is later killed #then its rollup file is gone and nothing of it is ever sent", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const recorder = createTransportRecorder()
      let consent = true
      let clock = 1_000_000
      const pi = new FakeExtensionAPI()
      createOmoNativeTelemetryComponent({
        rawTurnSampleRate: 0,
        consentNow: () => clock,
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => consent,
        now: FIXED_NOW,
        osProvider: createOsProvider("midway-host"),
        stateDir,
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("midway"))
      await pi.dispatch("turn_end", turnEnd(), context("midway"))
      await pi.dispatch("turn_end", turnEnd(), context("midway"))
      expect(rollupFiles(stateDir)).toHaveLength(1)

      // when: telemetry is turned off, one more turn ends after the consent cache expired, and the process dies
      consent = false
      clock += 60_000
      await pi.dispatch("turn_end", turnEnd(), context("midway"))

      // then: the session deleted its own rollup on the first write after opting out
      expect(rollupFiles(stateDir)).toEqual([])
      killWithoutShutdown(stateDir)
      const later = new FakeExtensionAPI()
      createOmoNativeTelemetryComponent({
        rawTurnSampleRate: 0,
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("midway-host"),
        stateDir,
        transportFactory: recorder.factory,
      }).register(later, { config: later, logger: createSilentLogger() })
      await later.dispatch("session_start", { type: "session_start", reason: "startup" }, context("later"))
      await later.dispatch("turn_end", turnEnd(), context("later"))
      expect(recorder.messages.filter(({ event, properties }) => event === "session_summary" && properties?.$session_id === "hashed:midway")).toEqual([])
    })
  })

  // The fan-in drops an event only when `$session_id` is the opted-out sentinel. That is enough: when
  // consent is off at start no session client exists at all, and a mid-session withdrawal is caught by
  // the consent read before each write. Here every later event keeps the live session's real hash in
  // `$session_id` (so the sentinel drop cannot fire) while other producers hash to the sentinel, and
  // still nothing leaves the process after the withdrawal.
  test("#given a sampled session that withdraws consent mid-way #when every producer fires again #then nothing is sent after the withdrawal and no message carries the sentinel", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const computer = computerObservers()
      let consent = true
      let clock = 1_000_000
      const pi = new FakeExtensionAPI()
      createOmoNativeTelemetryComponent({
        computerUseTelemetryObservers: computer.registry,
        consentNow: () => clock,
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => consent,
        now: FIXED_NOW,
        osProvider: createOsProvider("withdraw-host"),
        rawTurnSampleRate: 1,
        scheduleConsentCheck: () => () => undefined,
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("withdrawn"))
      await pi.dispatch("turn_end", turnEnd(), context("withdrawn"))
      expect(nativeMessages(recorder.messages).map(({ event }) => event)).toContain("turn_completed")
      const sentBefore = recorder.messages.length

      // when
      consent = false
      clock += 60_000
      await pi.dispatch("turn_end", turnEnd(), context("withdrawn"))
      await pi.dispatch("tool_result", toolResult(), context("withdrawn"))
      computer.publish({ kind: "activation", sessionId: "withdrawn", active: true, source: "tool_call", platform: "linux", backend: "x11" })
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context("withdrawn"))

      // then
      expect(recorder.messages.slice(sentBefore)).toEqual([])
      expect(recorder.messages.filter((message) => JSON.stringify(message).includes("opted-out"))).toEqual([])
    })
  })

  // #10328: every native event type, not only the ones today's producers happen to emit, must stop at
  // the fan-in once consent is withdrawn mid-session. The names come from the facade's own allowlist
  // (the list `isOmoNativeEventName` reads), so a new event type is covered without editing this test.
  test("#given a consented session whose consent is withdrawn mid-way #when every facade event type is captured through the fan-in #then each one reached the transport before and none reaches it after", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given: the fan-in the component hands its producers
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      let consent = true
      let clock = 1_000_000
      let fanIn: ((name: string, properties: Record<string, unknown>) => void) | undefined
      const original = parallelSummaryModule.registerOmoNativeParallelSummary
      const spy = spyOn(parallelSummaryModule, "registerOmoNativeParallelSummary").mockImplementation((pi, options) => {
        fanIn = options.captureEvent as unknown as (name: string, properties: Record<string, unknown>) => void
        return original(pi, options)
      })
      const pi = new FakeExtensionAPI()
      try {
        createOmoNativeTelemetryComponent({
          consentNow: () => clock,
          env: createEnabledEnv(agentDir),
          hashSessionId: (raw) => `hashed:${raw}`,
          isConfigEnabled: () => consent,
          now: FIXED_NOW,
          osProvider: createOsProvider("every-type-host"),
          rawTurnSampleRate: 0,
          scheduleConsentCheck: () => () => undefined,
          stateDir: join(agentDir, "omo-senpi", "omo-native"),
          transportFactory: recorder.factory,
        }).register(pi, { config: pi, logger: createSilentLogger() })
      } finally {
        spy.mockRestore()
      }
      if (fanIn === undefined) throw new Error("the component never handed its fan-in to the parallel-summary producer")
      const capture = fanIn
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("every-type"))
      const eventTypes = Object.keys(OMO_NATIVE_PROPERTY_ALLOWLISTS)
      const sentFor = (name: string, from: number) => recorder.messages.slice(from).filter(({ event }) => event === name)

      // then (control): while consented, each type reaches the transport through this exact path
      const deliveredWhileConsented: string[] = []
      for (const name of eventTypes) {
        const from = recorder.messages.length
        capture(name, { $session_id: "hashed:every-type" })
        if (sentFor(name, from).length > 0) deliveredWhileConsented.push(name)
      }
      expect(deliveredWhileConsented).toEqual(eventTypes)

      // when: consent is withdrawn and the consent cache has expired
      consent = false
      clock += CONSENT_CACHE_MS + 1
      const sentBefore = recorder.messages.length
      const attempted: string[] = []
      for (const name of eventTypes) {
        capture(name, { $session_id: "hashed:every-type" })
        attempted.push(name)
      }

      // then
      expect(attempted).toHaveLength(Object.keys(OMO_NATIVE_PROPERTY_ALLOWLISTS).length)
      expect(recorder.messages.slice(sentBefore).map(({ event }) => event)).toEqual([])
    })
  })

  // M1 on #10232: opting out mid-session and being killed before the next turn left the opted-in window
  // on disk, marked enabled, for the next opted-in process to send.
  for (const nextProcessOptedIn of [true, false]) {
    test(`#given opted-in turns then an opt-out and a kill before the next turn #when the next process is opted ${nextProcessOptedIn ? "in" : "out"} #then no event of the earlier window is sent and no file is left`, async () => {
      await withTempAgentDir(async (agentDir) => {
        writeInventory(agentDir)
        const stateDir = join(agentDir, "omo-senpi", "omo-native")
        const recorder = createTransportRecorder()
        let consent = true
        const ticks: Array<() => void> = []
        const register = () => {
          const pi = new FakeExtensionAPI()
          createOmoNativeTelemetryComponent({
            rawTurnSampleRate: 0,
            env: createEnabledEnv(agentDir),
            hashSessionId: (raw) => `hashed:${raw}`,
            isConfigEnabled: () => consent,
            now: FIXED_NOW,
            osProvider: createOsProvider("kill-host"),
            scheduleConsentCheck: (check: () => void) => {
              ticks.push(check)
              return () => undefined
            },
            stateDir,
            transportFactory: recorder.factory,
          }).register(pi, { config: pi, logger: createSilentLogger() })
          return pi
        }

        // given: two opted-in turns are on disk, then telemetry is turned off and the timer ticks once
        const first = register()
        await first.dispatch("session_start", { type: "session_start", reason: "startup" }, context("killed"))
        await first.dispatch("turn_end", turnEnd(), context("killed"))
        await first.dispatch("turn_end", turnEnd(), context("killed"))
        expect(rollupFiles(stateDir)).toHaveLength(1)
        consent = false
        for (const tick of ticks) tick()

        // then: the window left disk before any further turn
        expect(rollupFiles(stateDir)).toEqual([])

        // when: the process dies and the next one starts
        killWithoutShutdown(stateDir)
        consent = nextProcessOptedIn
        const next = register()
        await next.dispatch("session_start", { type: "session_start", reason: "startup" }, context("next"))
        await next.dispatch("turn_end", turnEnd(), context("next"))
        await next.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context("next"))

        // then
        expect(recorder.messages.filter(({ event, properties }) => event === "session_summary" && properties?.$session_id === "hashed:killed")).toEqual([])
        expect(rollupFiles(stateDir)).toEqual([])
      })
    })
  }

  test("#given a session in project A that opts out and is killed before any check #when a process in project B recovers #then A's window is dropped unsent", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const recorder = createTransportRecorder()
      let projectAEnabled = true
      const register = (cwd: string) => {
        const pi = new FakeExtensionAPI()
        pi.cwd = cwd
        createOmoNativeTelemetryComponent({
          rawTurnSampleRate: 0,
          env: createEnabledEnv(agentDir),
          hashSessionId: (raw) => `hashed:${raw}`,
          isConfigEnabled: (configCwd) => configCwd !== "/project-a" || projectAEnabled,
          now: FIXED_NOW,
          osProvider: createOsProvider("project-host"),
          scheduleConsentCheck: () => () => undefined,
          stateDir,
          transportFactory: recorder.factory,
        }).register(pi, { config: pi, logger: createSilentLogger() })
        return pi
      }
      const inProject = (sessionId: string, cwd: string) => ({ cwd, sessionManager: { getSessionId: () => sessionId } })

      // given: project A records two turns, opts out in its project config, and dies with no turn or tick after
      const a = register("/project-a")
      await a.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("a", "/project-a"))
      await a.dispatch("turn_end", turnEnd(), inProject("a", "/project-a"))
      await a.dispatch("turn_end", turnEnd(), inProject("a", "/project-a"))
      projectAEnabled = false
      killWithoutShutdown(stateDir)

      // when: an opted-in session in project B recovers orphans
      const b = register("/project-b")
      await b.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("b", "/project-b"))
      await b.dispatch("turn_end", turnEnd(), inProject("b", "/project-b"))

      // then
      expect(recorder.messages.filter(({ event, properties }) => event === "session_summary" && properties?.$session_id === "hashed:a")).toEqual([])
      expect(rollupFiles(stateDir).filter((name) => name.includes("_a") || name === "hashed_a.json")).toEqual([])
    })
  })

  test("#given many turns inside the consent cache window #when they end #then the omo config is read once, and again only after the window", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      let clock = 1_000_000
      const reads: Array<string | undefined> = []
      const pi = new FakeExtensionAPI()
      pi.cwd = "/cached"
      createOmoNativeTelemetryComponent({
        rawTurnSampleRate: 0,
        consentNow: () => clock,
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: (cwd) => {
          reads.push(cwd)
          return true
        },
        now: FIXED_NOW,
        osProvider: createOsProvider("cache-host"),
        scheduleConsentCheck: () => () => undefined,
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      const ctx = { cwd: "/cached", sessionManager: { getSessionId: () => "cached" } }
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, ctx)

      // when: five turns end at the same instant
      const before = reads.length
      for (let index = 0; index < 5; index += 1) await pi.dispatch("turn_end", turnEnd(), ctx)
      const duringWindow = reads.length - before
      clock += 60_000
      await pi.dispatch("turn_end", turnEnd(), ctx)

      // then
      expect(duringWindow).toBeLessThanOrEqual(1)
      expect(reads.length - before - duringWindow).toBe(1)
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
