import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createOmoNativeTelemetryComponent } from "./omo-native-component"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  createTransportRecorder,
  withTempAgentDir,
} from "./telemetry.test-support"

function writeInventory(agentDir: string): void {
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { openai: { models: [{ id: "gpt-5.6-sol" }] } } }))
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-5.6-sol" }))
}

function context(sessionId: string): Record<string, unknown> {
  return { cwd: "/repo", sessionManager: { getSessionId: () => sessionId } }
}

describe("a task-host warm-up session reports nothing", () => {
  async function eventsOf(sessionContext: Readonly<Record<string, string>>): Promise<readonly string[]> {
    return withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const recorder = createTransportRecorder()
      const pi = Object.assign(new FakeExtensionAPI(), { sessionContext })
      const session = context("warm-up-session")
      createOmoNativeTelemetryComponent({
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: FIXED_NOW,
        osProvider: createOsProvider("warm-up-host"),
        stateDir: join(agentDir, "omo-senpi", "omo-native"),
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)
      return recorder.messages.map(({ event }) => event)
    })
  }

  test("#given the session that warms a fresh task host #when it starts and closes #then no telemetry event is captured", async () => {
    expect(await eventsOf({ role: "child", task_id: "host-warmup", host_warmup: "1" })).toEqual([])
  })

  test("#given an ordinary host child session #when it starts and closes #then it still reports its session", async () => {
    expect(await eventsOf({ role: "child", task_id: "t-1" })).toContain("session_started")
  })
})
