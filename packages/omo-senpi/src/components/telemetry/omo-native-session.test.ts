import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import {
  getTelemetryActivityStateFilePath,
  type TelemetryCaptureMessage,
  type TelemetryDiagnosticInput,
  type TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { getSenpiTelemetryStateDir, SENPI_TELEMETRY_EVENT_NAME } from "./index"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS, getOmoNativeStateDir } from "./product-identity"
import { createOmoNativeSessionComponent } from "./omo-native-session"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  withTempAgentDir,
} from "./telemetry.test-support"

type Recorder = {
  readonly messages: TelemetryCaptureMessage[]
  readonly factory: TelemetryTransportFactory
  readonly flushes: number[]
  readonly shutdowns: number[]
}

function createRecorder(): Recorder {
  const messages: TelemetryCaptureMessage[] = []
  const flushes: number[] = []
  const shutdowns: number[] = []
  return {
    messages,
    flushes,
    shutdowns,
    factory: () => {
      const index = flushes.length
      flushes.push(0)
      shutdowns.push(0)
      return {
        capture: (message) => messages.push(message),
        flush: async () => { flushes[index] = (flushes[index] ?? 0) + 1 },
        shutdown: async () => { shutdowns[index] = (shutdowns[index] ?? 0) + 1 },
      }
    },
  }
}

function writeInventory(agentDir: string, input: {
  readonly providers?: Record<string, { readonly models?: readonly { readonly id: string }[] }>
  readonly defaultProvider?: string
  readonly defaultModel?: string
} = {}): void {
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: input.providers ?? {} }))
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    ...(input.defaultProvider === undefined ? {} : { defaultProvider: input.defaultProvider }),
    ...(input.defaultModel === undefined ? {} : { defaultModel: input.defaultModel }),
  }))
}

function sessionCtx(sessionId = "session-1", cwd = "/repo"): unknown {
  return { cwd, sessionManager: { getSessionId: () => sessionId } }
}

function register(agentDir: string, recorder: Recorder, options: {
  readonly env?: Record<string, string | undefined>
  readonly now?: Date
  readonly configEnabled?: boolean
  readonly diagnostics?: (input: TelemetryDiagnosticInput | { readonly event: "omo_native_inventory_read_failed" }) => void
  readonly setTimeoutFn?: (callback: () => void, delay: number) => unknown
  readonly timeZone?: () => string
} = {}): FakeExtensionAPI {
  const pi = new FakeExtensionAPI()
  const configEnabled = options.configEnabled
  createOmoNativeSessionComponent({
    diagnostics: options.diagnostics,
    env: options.env ?? createEnabledEnv(agentDir),
    hashSessionId: (raw) => `hashed:${raw}`,
    ...(configEnabled === undefined ? {} : { isConfigEnabled: () => configEnabled }),
    now: options.now ?? FIXED_NOW,
    osProvider: createOsProvider("native-session-host"),
    setTimeoutFn: options.setTimeoutFn,
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    transportFactory: recorder.factory,
  }).register(pi, { config: pi, logger: createSilentLogger() })
  return pi
}

function registryCtx(sessionId: string): unknown {
  const models = [
    { provider: "anthropic", id: "claude-opus-5" },
    { provider: "anthropic", id: "claude-fable-5" },
    { provider: "openai", id: "gpt-5.6-sol" },
  ]
  return {
    cwd: "/repo",
    sessionManager: { getSessionId: () => sessionId },
    modelRegistry: {
      getAvailable: () => models,
      find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
    },
  }
}

const SHARED_KEYS = [
  "$process_person_profile", "install_id", "package_version", "platform", "product_name", "schema_version", "surface",
]

describe("OmO Native session telemetry", () => {
  it.each([
    ["DO_NOT_TRACK", { DO_NOT_TRACK: "1" }, true],
    ["omo.json telemetry.enabled false", {}, undefined],
  ])("#given %s #when session_start fires #then native and legacy telemetry both emit nothing", async (name, optOut, configEnabled) => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const recorder = createRecorder()
      const home = join(agentDir, "home")
      if (name === "omo.json telemetry.enabled false") {
        mkdirSync(join(home, ".omo"), { recursive: true })
        writeFileSync(join(home, ".omo", "omo.json"), '{"telemetry":{"enabled":false}}')
      }
      const env = { ...createEnabledEnv(agentDir), HOME: home, ...optOut }
      const pi = register(agentDir, recorder, { env, configEnabled })

      // when
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx())

      // then
      expect(recorder.messages).toEqual([])
      expect(existsSync(getTelemetryActivityStateFilePath(getOmoNativeStateDir(env)))).toBe(false)
      expect(existsSync(getTelemetryActivityStateFilePath(getSenpiTelemetryStateDir(env)))).toBe(false)
    })
  })

  it.each([
    ["no config file", undefined, true],
    ["telemetry enabled false", '{"telemetry":{"enabled":false}}', false],
    ["telemetry enabled true", '{"telemetry":{"enabled":true}}', true],
  ])("#given %s #when session_start loads config #then telemetry matches the resolved setting", async (_name, config, expectedEnabled) => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const home = join(agentDir, "home")
      const cwd = join(home, "project")
      mkdirSync(cwd, { recursive: true })
      if (config !== undefined) {
        mkdirSync(join(home, ".omo"), { recursive: true })
        writeFileSync(join(home, ".omo", "omo.json"), config)
      }
      const recorder = createRecorder()
      const pi = register(agentDir, recorder, { env: { ...createEnabledEnv(agentDir), HOME: home } })

      // when
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx("config", cwd))

      // then
      expect(recorder.messages.some(({ event }) => event === "session_started")).toBe(expectedEnabled)
    })
  })

  it("#given malformed existing config #when session_start loads config #then telemetry is disabled and a diagnostic is emitted", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const home = join(agentDir, "home")
      const cwd = join(home, "project")
      mkdirSync(join(home, ".omo"), { recursive: true })
      mkdirSync(cwd, { recursive: true })
      writeFileSync(join(home, ".omo", "omo.json"), '{"telemetry":{"enabled":false}')
      const diagnostics: Array<TelemetryDiagnosticInput | { readonly event: "omo_native_inventory_read_failed" }> = []
      const recorder = createRecorder()
      const pi = register(agentDir, recorder, {
        diagnostics: (input) => diagnostics.push(input),
        env: { ...createEnabledEnv(agentDir), HOME: home },
      })

      // when
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx("malformed", cwd))

      // then
      expect(recorder.messages).toEqual([])
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        errorKind: "error",
        event: "telemetry_capture_failed",
        source: "omo-native-session",
      })
    })
  })

  it("#given unreadable existing config #when session_start loads config #then telemetry is disabled and a diagnostic is emitted", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const home = join(agentDir, "home")
      const cwd = join(home, "project")
      mkdirSync(join(home, ".omo", "omo.json"), { recursive: true })
      mkdirSync(cwd, { recursive: true })
      const diagnostics: Array<TelemetryDiagnosticInput | { readonly event: "omo_native_inventory_read_failed" }> = []
      const recorder = createRecorder()
      const pi = register(agentDir, recorder, {
        diagnostics: (input) => diagnostics.push(input),
        env: { ...createEnabledEnv(agentDir), HOME: home },
      })

      // when
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx("unreadable", cwd))

      // then
      expect(recorder.messages).toEqual([])
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        errorKind: "error",
        event: "telemetry_capture_failed",
        source: "omo-native-session",
      })
    })
  })

  it("#given enabled telemetry #when two clients start today and one starts tomorrow #then native daily_active emits once per UTC day", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const recorder = createRecorder()
      const first = register(agentDir, recorder)
      const stale = register(agentDir, recorder)
      const tomorrow = register(agentDir, recorder, { now: new Date(FIXED_NOW.getTime() + 86_400_000) })

      // when
      await first.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx("first"))
      await stale.dispatch("session_start", { type: "session_start", reason: "resume" }, sessionCtx("stale"))
      await tomorrow.dispatch("session_start", { type: "session_start", reason: "new" }, sessionCtx("tomorrow"))

      // then
      expect(recorder.messages.filter(({ event }) => event === "daily_active").map(({ properties }) => properties?.day_utc)).toEqual([
        "2026-07-03",
        "2026-07-04",
      ])
      expect(recorder.messages.filter(({ event }) => event === SENPI_TELEMETRY_EVENT_NAME)).toHaveLength(2)
    })
  })

  it("#given real-shape providers/defaultProvider/defaultModel fixtures #when session_started emits #then inventory is masked and the key set is exact", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir, {
        providers: {
          anthropic: { models: [{ id: "claude-sonnet-5" }, { id: "private-model" }] },
          private_cloud: { models: [{ id: "secret-model" }] },
        },
        defaultProvider: "anthropic",
        defaultModel: "private-model",
      })
      const recorder = createRecorder()
      const pi = register(agentDir, recorder)

      // when
      await pi.dispatch("session_start", { type: "session_start", reason: "fork" }, sessionCtx("inventory"))

      // then
      const captured = recorder.messages.find(({ event }) => event === "session_started")
      expect(captured?.properties).toMatchObject({
        $os: "darwin",
        $os_version: "26.3.1",
        $session_id: "hashed:inventory",
        arch: "arm64",
        cpu_count: 1,
        default_model: "custom",
        default_provider: "anthropic",
        memory_bucket: "64_plus_gb",
        model_count: 3,
        provider_count: 2,
        providers: "anthropic",
        reason: "fork",
      })
      expect(Object.keys(captured?.properties ?? {}).sort()).toEqual([
        ...OMO_NATIVE_PROPERTY_ALLOWLISTS.session_started,
        ...SHARED_KEYS,
      ].sort())
    })
  })

  it("#given an injected IANA time zone #when session_started is captured #then timezone is present, at most 64 characters, and category_config is captured once afterwards with the same $session_id", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const recorder = createRecorder()
      const pi = register(agentDir, recorder, { timeZone: () => "Asia/Seoul" })

      // when
      await pi.dispatch("session_start", { type: "session_start", reason: "resume" }, registryCtx("zoned"))

      // then
      const started = recorder.messages.find(({ event }) => event === "session_started")
      expect(started?.properties?.timezone).toBe("Asia/Seoul")
      expect(String(started?.properties?.timezone).length).toBeLessThanOrEqual(64)
      const configs = recorder.messages.filter(({ event }) => event === "category_config")
      expect(configs).toHaveLength(1)
      expect(configs[0]?.properties?.$session_id).toBe(started?.properties?.$session_id)
      expect(configs[0]?.properties?.source).toBe("resume")
      expect(Object.keys(configs[0]?.properties ?? {}).sort()).toEqual([
        ...OMO_NATIVE_PROPERTY_ALLOWLISTS.category_config,
        ...SHARED_KEYS,
      ].sort())
      expect(recorder.messages.map(({ event }) => event).indexOf("category_config")).toBeGreaterThan(
        recorder.messages.map(({ event }) => event).indexOf("session_started"),
      )
    })
  })

  it("#given a host context without a model registry #when session_start fires #then session_started still ships and no category_config is captured", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const recorder = createRecorder()
      const pi = register(agentDir, recorder)

      // when
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx("registryless"))

      // then
      expect(recorder.messages.some(({ event }) => event === "session_started")).toBe(true)
      expect(recorder.messages.filter(({ event }) => event === "category_config")).toEqual([])
    })
  })

  it("#given a throwing time zone provider #when session_start fires #then session_started ships without a timezone property", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const recorder = createRecorder()
      const pi = register(agentDir, recorder, {
        timeZone: () => {
          throw new Error("no ICU")
        },
      })

      // when
      await expect(pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx("zoneless"))).resolves.toBeDefined()

      // then
      expect(recorder.messages.find(({ event }) => event === "session_started")?.properties).not.toHaveProperty("timezone")
    })
  })

  it("#given an existing same-day legacy marker #when the native session path runs #then its bytes stay unchanged and native uses its separate marker", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const env = createEnabledEnv(agentDir)
      const legacyStateFile = getTelemetryActivityStateFilePath(getSenpiTelemetryStateDir(env))
      mkdirSync(getSenpiTelemetryStateDir(env), { recursive: true })
      const before = Buffer.from('{"lastActiveDayUTC":"2026-07-03"}\n')
      writeFileSync(legacyStateFile, before)
      const recorder = createRecorder()
      const pi = register(agentDir, recorder, { env })

      // when
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx())

      // then
      expect(readFileSync(legacyStateFile)).toEqual(before)
      expect(recorder.messages.map(({ event }) => event)).toContain("daily_active")
      expect(recorder.messages.map(({ event }) => event)).not.toContain(SENPI_TELEMETRY_EVENT_NAME)
    })
  })

  it.each([
    ["corrupt models.json", "{not json"],
    ["absent inventory", undefined],
  ])("#given %s #when session_start fires #then counts are zero, defaults are omitted, and one diagnostic is reported", async (_name, modelsContent) => {
    await withTempAgentDir(async (agentDir) => {
      // given
      mkdirSync(agentDir, { recursive: true })
      if (modelsContent !== undefined) writeFileSync(join(agentDir, "models.json"), modelsContent)
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-5" }))
      const diagnostics: Array<TelemetryDiagnosticInput | { readonly event: "omo_native_inventory_read_failed" }> = []
      const recorder = createRecorder()
      const pi = register(agentDir, recorder, { diagnostics: (input) => diagnostics.push(input) })

      // when
      await expect(pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx())).resolves.toBeDefined()

      // then
      const properties = recorder.messages.find(({ event }) => event === "session_started")?.properties
      expect(properties).toMatchObject({ model_count: 0, provider_count: 0, providers: "" })
      expect(properties).not.toHaveProperty("default_provider")
      expect(properties).not.toHaveProperty("default_model")
      expect(diagnostics.filter(({ event }) => event === "omo_native_inventory_read_failed")).toHaveLength(1)
    })
  })

  it("#given an empty providers dictionary #when session_start fires #then inventory is valid and empty without a diagnostic", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const diagnostics: Array<TelemetryDiagnosticInput | { readonly event: "omo_native_inventory_read_failed" }> = []
      const recorder = createRecorder()
      const pi = register(agentDir, recorder, { diagnostics: (input) => diagnostics.push(input) })

      // when
      await pi.dispatch("session_start", { type: "session_start", reason: "reload" }, sessionCtx())

      // then
      expect(recorder.messages.find(({ event }) => event === "session_started")?.properties).toMatchObject({
        model_count: 0,
        provider_count: 0,
        providers: "",
      })
      expect(diagnostics).toEqual([])
    })
  })

  it("#given an injected timer #when session_shutdown fires #then the native client flushes once and uses the 1000ms bound", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeInventory(agentDir)
      const delays: number[] = []
      const recorder = createRecorder()
      const pi = register(agentDir, recorder, { setTimeoutFn: (_callback, delay) => { delays.push(delay); return 1 } })
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx())

      // when
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, sessionCtx())

      // then
      expect(recorder.flushes).toEqual([1, 1])
      expect(recorder.shutdowns).toEqual([1, 1])
      expect(delays).toEqual([1_000])
    })
  })
})
