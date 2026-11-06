import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import type { TelemetryCaptureMessage, TelemetryEnv, TelemetryTransportFactory } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createOmoNativeSessionComponent } from "./omo-native-session"
import { getOmoNativeStateDir } from "./product-identity"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  withTempAgentDir,
} from "./telemetry.test-support"

// Legacy operational crash files must never become automatic telemetry.
const HOST_ENDPOINT = "0123456789abcdef"
const RECENT = new Date(FIXED_NOW.getTime() - 60_000).toISOString()

function writeRecords(agentDir: string, host: readonly string[], process: readonly string[]): void {
  const hostDir = join(agentDir, "rpc-host-daemon", HOST_ENDPOINT)
  mkdirSync(hostDir, { recursive: true })
  writeFileSync(join(hostDir, "crashes.jsonl"), host.map((line) => `${line}\n`).join(""))
  mkdirSync(join(agentDir, "process-crashes"), { recursive: true })
  writeFileSync(join(agentDir, "process-crashes", "crashes.jsonl"), process.map((line) => `${line}\n`).join(""))
}

const LEGACY_HOST_RECORD = JSON.stringify({ at: RECENT, signal: "SIGSEGV", uptimeMs: 3_061_000 })

const TUI_RECORD = JSON.stringify({
  at: RECENT,
  kind: "interactive",
  detection: "unclean_exit",
  uptimeMs: 420_000,
  bunVersion: "1.4.2",
  senpiVersion: "2026.9.27-2",
  productVersion: "5.0.1",
})

async function startProcess(agentDir: string, messages: TelemetryCaptureMessage[], env?: TelemetryEnv): Promise<void> {
  const pi = new FakeExtensionAPI()
  const factory: TelemetryTransportFactory = () => ({
    capture: (message) => messages.push(message),
    flush: async () => undefined,
    shutdown: async () => undefined,
  })
  createOmoNativeSessionComponent({
    env: env ?? createEnabledEnv(agentDir),
    hashSessionId: (raw) => `hashed:${raw}`,
    isConfigEnabled: () => true,
    now: FIXED_NOW,
    osProvider: createOsProvider("crash-host"),
    transportFactory: factory,
  }).register(pi, { config: pi, logger: createSilentLogger() })
  await pi.dispatch(
    "session_start",
    { type: "session_start", reason: "startup" },
    { cwd: "/repo", sessionManager: { getSessionId: () => "s" } },
  )
}

const crashes = (messages: readonly TelemetryCaptureMessage[]) => messages.filter(({ event }) => event === "process_crashed")

describe("retired automatic crash reporting", () => {
  it("does not harvest operational crashes without separate crash consent", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeRecords(agentDir, [LEGACY_HOST_RECORD], [TUI_RECORD])
      const messages: TelemetryCaptureMessage[] = []
      await startProcess(agentDir, messages)
      await startProcess(agentDir, messages)
      expect(messages.some(({ event }) => event === "session_started")).toBe(true)
      expect(crashes(messages)).toEqual([])
      expect(existsSync(join(getOmoNativeStateDir(createEnabledEnv(agentDir)), "crash-reports"))).toBe(false)
      expect(readFileSync(join(agentDir, "process-crashes", "crashes.jsonl"), "utf8")).toBe(TUI_RECORD + "\n")
      expect(readFileSync(join(agentDir, "rpc-host-daemon", HOST_ENDPOINT, "crashes.jsonl"), "utf8")).toBe(LEGACY_HOST_RECORD + "\n")
    })
  })

  it("keeps telemetry opt-out independent from local crash records", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeRecords(agentDir, [LEGACY_HOST_RECORD], [TUI_RECORD])
      const messages: TelemetryCaptureMessage[] = []
      await startProcess(agentDir, messages, { ...createEnabledEnv(agentDir), DO_NOT_TRACK: "1" })
      expect(messages).toEqual([])
      expect(existsSync(join(getOmoNativeStateDir(createEnabledEnv(agentDir)), "crash-reports"))).toBe(false)
    })
  })
})
