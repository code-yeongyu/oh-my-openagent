import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import {
  UNCONFIGURED_POSTHOG_API_KEY,
  type TelemetryDiagnosticInput,
} from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createOmoNativeNoticeRegistration } from "./omo-native-notice"
import { getOmoNativeStateDir } from "./product-identity"
import {
  createEnabledEnv,
  createSilentLogger,
  withTempAgentDir,
} from "./telemetry.test-support"

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

describe("OmO Native telemetry notice", () => {
  it("#given telemetry registration #when commands are inspected #then no telemetry audit command is exposed", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = register(agentDir)

      // when
      const commandNames = pi.commands.map(({ name }) => name)

      // then
      expect(commandNames).not.toContain("omo-telemetry")
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

  it("#given the unconfigured project key #when session_start fires #then no first-run notice is sent", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const env = {
        POSTHOG_API_KEY: UNCONFIGURED_POSTHOG_API_KEY,
        SENPI_CODING_AGENT_DIR: agentDir,
      }
      const pi = register(agentDir, { env })
      const notifications: string[] = []

      // when
      await pi.dispatch("session_start", {}, { ui: { notify: (message: string) => notifications.push(message) } })

      // then
      expect(notifications).toEqual([])
      expect(existsSync(join(getOmoNativeStateDir(env), "notice-shown"))).toBe(false)
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

  it("#given telemetry.enabled false #when session_start fires #then no notice or marker is created", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const home = join(agentDir, "home")
      const cwd = join(home, "project")
      mkdirSync(join(home, ".omo"), { recursive: true })
      mkdirSync(cwd, { recursive: true })
      writeFileSync(join(home, ".omo", "omo.json"), '{"telemetry":{"enabled":false}}')
      const env = { ...createEnabledEnv(agentDir), HOME: home }
      const pi = register(agentDir, { env })
      const notifications: string[] = []

      // when
      await pi.dispatch("session_start", {}, {
        cwd,
        ui: { notify: (message: string) => notifications.push(message) },
      })

      // then
      expect(notifications).toEqual([])
      expect(existsSync(join(getOmoNativeStateDir(env), "notice-shown"))).toBe(false)
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

})
