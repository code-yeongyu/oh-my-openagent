import { existsSync } from "node:fs"
import { describe, expect, it } from "bun:test"

import { getTelemetryActivityStateFilePath } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  SENPI_TELEMETRY_EVENT_NAME,
  createSenpiTelemetryComponent,
  getSenpiTelemetryStateDir,
  recordSenpiDailyActive,
} from "./index"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  createTransportRecorder,
  readStamp,
  withTempAgentDir,
} from "./telemetry.test-support"

describe("omo-senpi telemetry daily activity", () => {
  it("#given no daily stamp #when session_start fires #then first session emits daily-active telemetry", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = new FakeExtensionAPI()
      const transport = createTransportRecorder()

      // when
      createSenpiTelemetryComponent({
        env: createEnabledEnv(agentDir),
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-first-host"),
        timeoutMs: 50,
        transportFactory: transport.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch("session_start", {})
      await recordSenpiDailyActive({
        env: createEnabledEnv(agentDir),
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-first-host"),
        stateDir: getSenpiTelemetryStateDir(createEnabledEnv(agentDir)),
        timeoutMs: 50,
        transportFactory: transport.factory,
      })

      // then
      expect(transport.messages).toHaveLength(1)
      expect(transport.messages[0]?.event).toBe(SENPI_TELEMETRY_EVENT_NAME)
    })
  })

  it("#given a same-day stamp #when session_start fires again #then second same-day session does not emit", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const transport = createTransportRecorder()
      const options = {
        env: createEnabledEnv(agentDir),
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-repeat-host"),
        timeoutMs: 50,
        transportFactory: transport.factory,
      }

      // when
      await recordSenpiDailyActive(options)
      await recordSenpiDailyActive(options)

      // then
      expect(transport.messages).toHaveLength(1)
    })
  })

  it.each([
    ["product disable opt-out", { OMO_SENPI_DISABLE_POSTHOG: "1" }],
    ["product anonymous telemetry opt-out", { OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: "0" }],
    ["global opt-out", { OMO_DISABLE_POSTHOG: "1" }],
  ])("#given %s #when session_start fires #then opt-out suppresses emission and stamp writes", async (_name, optOutEnv) => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const transport = createTransportRecorder()
      const env = {
        ...createEnabledEnv(agentDir),
        ...optOutEnv,
      }
      const stateDir = getSenpiTelemetryStateDir(env)

      // when
      await recordSenpiDailyActive({
        env,
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-opt-out-host"),
        timeoutMs: 50,
        transportFactory: transport.factory,
      })

      // then
      expect(transport.messages).toEqual([])
      expect(existsSync(getTelemetryActivityStateFilePath(stateDir))).toBe(false)
    })
  })

  it("#given SENPI_CODING_AGENT_DIR #when telemetry records #then stamp file location respects the isolated senpi agent dir", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const transport = createTransportRecorder()
      const env = createEnabledEnv(agentDir)
      const stateDir = getSenpiTelemetryStateDir(env)

      // when
      await recordSenpiDailyActive({
        env,
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-stamp-host"),
        timeoutMs: 50,
        transportFactory: transport.factory,
      })

      // then
      expect(stateDir.startsWith(agentDir)).toBe(true)
      expect(readStamp(stateDir)).toEqual({ lastActiveDayUTC: "2026-07-03" })
    })
  })
})
