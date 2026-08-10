import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import type { TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createOmoNativeNoticeRegistration } from "./omo-native-notice"
import { getOmoNativePayloadFilePath } from "./omo-native-buffer"
import { getOmoNativeStateDir } from "./product-identity"
import {
  createEnabledEnv,
  createSilentLogger,
  withTempAgentDir,
} from "./telemetry.test-support"

type CommandContext = {
  readonly output?: (text: string) => void
  readonly ui?: { notify(message: string, type?: "info" | "warning" | "error"): void }
}

type CommandHandler = (args: string, ctx: CommandContext) => Promise<void>

function register(agentDir: string, options: {
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly env?: Record<string, string | undefined>
  readonly stateDir?: string
} = {}): FakeExtensionAPI {
  const pi = new FakeExtensionAPI()
  createOmoNativeNoticeRegistration({
    diagnostics: options.diagnostics,
    env: options.env ?? createEnabledEnv(agentDir),
    stateDir: options.stateDir,
  }).register(pi, { config: pi, logger: createSilentLogger() })
  return pi
}

function commandHandler(pi: FakeExtensionAPI): CommandHandler {
  const command = pi.commands.find(({ name }) => name === "omo-telemetry")
  const handler: unknown = command?.options["handler"]
  if (typeof handler !== "function") throw new Error("omo-telemetry command was not registered")
  return handler as CommandHandler
}

async function commandOutput(pi: FakeExtensionAPI, cwd?: string): Promise<string> {
  const lines: string[] = []
  await commandHandler(pi)("", { ...(cwd === undefined ? {} : { cwd }), output: (text) => lines.push(text) })
  return lines.join("\n")
}

describe("OmO Native telemetry notice and preview", () => {
  it.each([
    ["no config file", undefined, true],
    ["telemetry enabled false", '{"telemetry":{"enabled":false}}', false],
    ["telemetry enabled true", '{"telemetry":{"enabled":true}}', true],
  ])("#given %s #when preview loads config #then it reports the resolved enabled state", async (_name, config, expectedEnabled) => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const home = join(agentDir, "home")
      const cwd = join(home, "project")
      mkdirSync(cwd, { recursive: true })
      if (config !== undefined) {
        mkdirSync(join(home, ".omo"), { recursive: true })
        writeFileSync(join(home, ".omo", "omo.json"), config)
      }
      const pi = register(agentDir, { env: { ...createEnabledEnv(agentDir), HOME: home } })

      // when
      const output = await commandOutput(pi, cwd)

      // then
      expect(output).toContain(`omo.json telemetry.enabled: ${expectedEnabled}`)
    })
  })

  it("#given malformed existing config #when preview loads config #then it reports disabled and emits a diagnostic", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const home = join(agentDir, "home")
      const cwd = join(home, "project")
      mkdirSync(join(home, ".omo"), { recursive: true })
      mkdirSync(cwd, { recursive: true })
      writeFileSync(join(home, ".omo", "omo.json"), '{"telemetry":{"enabled":false}')
      const diagnostics: TelemetryDiagnosticInput[] = []
      const pi = register(agentDir, {
        diagnostics: (input) => diagnostics.push(input),
        env: { ...createEnabledEnv(agentDir), HOME: home },
      })

      // when
      const output = await commandOutput(pi, cwd)

      // then
      expect(output).toContain("omo.json telemetry.enabled: false")
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        errorKind: "error",
        event: "telemetry_capture_failed",
        source: "omo-native-notice",
      })
    })
  })

  it("#given unreadable existing config #when preview loads config #then it reports disabled and emits a diagnostic", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const home = join(agentDir, "home")
      const cwd = join(home, "project")
      mkdirSync(join(home, ".omo", "omo.json"), { recursive: true })
      mkdirSync(cwd, { recursive: true })
      const diagnostics: TelemetryDiagnosticInput[] = []
      const pi = register(agentDir, {
        diagnostics: (input) => diagnostics.push(input),
        env: { ...createEnabledEnv(agentDir), HOME: home },
      })

      // when
      const output = await commandOutput(pi, cwd)

      // then
      expect(output).toContain("omo.json telemetry.enabled: false")
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        errorKind: "error",
        event: "telemetry_capture_failed",
        source: "omo-native-notice",
      })
    })
  })

  it("#given enabled telemetry #when two consecutive session_start events fire #then the notice is sent exactly once", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = register(agentDir)
      const notifications: string[] = []
      const ctx = { ui: { notify: (message: string) => notifications.push(message) } }

      // when
      await pi.dispatch("session_start", {}, ctx)
      await pi.dispatch("session_start", {}, ctx)

      // then
      expect(notifications).toEqual([
        "omo-senpi sends anonymous usage telemetry (no prompts, no paths). Docs: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/senpi-telemetry.md - opt out: DO_NOT_TRACK=1",
      ])
    })
  })

  it("#given DO_NOT_TRACK=1 #when session_start fires #then no notice is sent", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = register(agentDir, { env: { ...createEnabledEnv(agentDir), DO_NOT_TRACK: "1" } })
      const notifications: string[] = []

      // when
      await pi.dispatch("session_start", {}, { ui: { notify: (message: string) => notifications.push(message) } })

      // then
      expect(notifications).toEqual([])
    })
  })

  it("#given an unwritable marker directory #when session_start fires twice #then notice is skipped with one diagnostic and no crash", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const blockedStateDir = join(agentDir, "blocked")
      writeFileSync(blockedStateDir, "not a directory")
      const diagnostics: TelemetryDiagnosticInput[] = []
      const pi = register(agentDir, { diagnostics: (input) => diagnostics.push(input), stateDir: blockedStateDir })
      const notifications: string[] = []

      // when
      await expect(pi.dispatch("session_start", {}, { ui: { notify: (message: string) => notifications.push(message) } })).resolves.toBeDefined()
      await expect(pi.dispatch("session_start", {}, { ui: { notify: (message: string) => notifications.push(message) } })).resolves.toBeDefined()

      // then
      expect(notifications).toEqual([])
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]?.source).toBe("omo-native-notice")
    })
  })

  it("#given a stale marker #when a later registration starts a session #then the notice stays suppressed", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const stateDir = getOmoNativeStateDir(createEnabledEnv(agentDir))
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, "notice-shown"), "shown\n")
      const pi = register(agentDir)
      const notifications: string[] = []

      // when
      await pi.dispatch("session_start", {}, { ui: { notify: (message: string) => notifications.push(message) } })

      // then
      expect(notifications).toEqual([])
    })
  })

  it("#given two racing session_start events #when both attempt the first notice #then the marker admits only one notification", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = register(agentDir)
      const notifications: string[] = []
      const ctx = { ui: { notify: (message: string) => notifications.push(message) } }

      // when
      await Promise.all([
        pi.dispatch("session_start", {}, ctx),
        pi.dispatch("session_start", {}, ctx),
      ])

      // then
      expect(notifications).toHaveLength(1)
    })
  })

  it("#given the first notification send throws #when another session starts #then the persisted marker prevents a retry", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = register(agentDir)
      let attempts = 0

      // when
      await pi.dispatch("session_start", {}, { ui: { notify: () => { attempts += 1; throw new Error("ui closed") } } })
      await pi.dispatch("session_start", {}, { ui: { notify: () => { attempts += 1 } } })

      // then
      expect(attempts).toBe(1)
    })
  })

  it("#given captured payloads #when omo-telemetry runs #then output includes enabled state, full opt-out matrix, event names, and payload content", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const env = {
        ...createEnabledEnv(agentDir),
        OMO_DISABLE_POSTHOG: "unset-test",
        OMO_SEND_ANONYMOUS_TELEMETRY: "0",
      }
      const stateDir = getOmoNativeStateDir(env)
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(getOmoNativePayloadFilePath(stateDir), JSON.stringify([
        { distinctId: "machine", event: "session_started", properties: { reason: "startup" } },
        { distinctId: "machine", event: "turn_completed", properties: { total_tokens: 42 } },
      ]))
      const pi = register(agentDir, { env })

      // when
      const output = await commandOutput(pi)

      // then
      expect(output).toContain("Enabled: false")
      for (const key of [
        "OMO_SENPI_DISABLE_POSTHOG",
        "OMO_DISABLE_POSTHOG",
        "OMO_SENPI_SEND_ANONYMOUS_TELEMETRY",
        "OMO_SEND_ANONYMOUS_TELEMETRY",
        "DO_NOT_TRACK",
        "omo.json telemetry.enabled",
      ]) expect(output).toContain(key)
      expect(output).toContain('"event": "session_started"')
      expect(output).toContain('"event": "turn_completed"')
      expect(output).toContain('"total_tokens": 42')
    })
  })

  it("#given last-payloads.json is absent or corrupt #when omo-telemetry runs #then each state prints a clear audit result without throwing", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = register(agentDir)

      // when
      const absent = await commandOutput(pi)
      const stateDir = getOmoNativeStateDir(createEnabledEnv(agentDir))
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(getOmoNativePayloadFilePath(stateDir), "[{\"event\":")
      const corrupt = await commandOutput(pi)

      // then
      expect(absent).toContain("No telemetry payloads have been recorded.")
      expect(corrupt).toContain("Telemetry payload preview is unreadable or malformed.")
    })
  })
})
