import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import type { TelemetryCaptureMessage } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createOmoNativeTelemetryComponent } from "./omo-native-component"
import { OMO_NATIVE_EVENT_SCHEMAS } from "./product-identity"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  createTransportRecorder,
  withTempAgentDir,
} from "./telemetry.test-support"

// Contract (plan D-P `omo.session.role`): session_started, turn_completed and session_summary carry one
// closed `session_role` so a delegated child's tokens are never counted twice against its root. The
// role is read from the session the host hands THIS registration, never from process-wide state.

const SESSION_EVENTS = ["session_started", "turn_completed", "session_summary"] as const

function turnEnd(): Record<string, unknown> {
  return {
    type: "turn_end",
    turnIndex: 0,
    message: {
      role: "assistant",
      content: [],
      provider: "openai",
      model: "gpt-5.6-sol",
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { total: 0.001 } },
      stopReason: "stop",
      timestamp: 1,
    },
    toolResults: [],
  }
}

async function rolesFor(decorate: (pi: FakeExtensionAPI) => void): Promise<readonly (readonly [string, unknown])[]> {
  return withTempAgentDir(async (agentDir) => {
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, "settings.json"), "{}")
    const recorder = createTransportRecorder()
    const pi = new FakeExtensionAPI()
    decorate(pi)
    const session = { cwd: "/repo", sessionManager: { getSessionId: () => "role-session" } }
    createOmoNativeTelemetryComponent({
      rawTurnSampleRate: 1,
      env: createEnabledEnv(agentDir),
      hashSessionId: (raw) => `hashed:${raw}`,
      isConfigEnabled: () => true,
      now: FIXED_NOW,
      osProvider: createOsProvider("role-host"),
      stateDir: join(agentDir, "omo-senpi", "omo-native"),
      transportFactory: recorder.factory,
    }).register(pi, { config: pi, logger: createSilentLogger() })

    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
    await pi.dispatch("turn_end", turnEnd(), session)
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)
    return sessionRoles(recorder.messages)
  })
}

function sessionRoles(messages: readonly TelemetryCaptureMessage[]): readonly (readonly [string, unknown])[] {
  return messages
    .filter(({ event }) => SESSION_EVENTS.some((name) => name === event))
    .map(({ event, properties }) => [event, properties?.["session_role"]] as const)
}

describe("session_role on session, turn and summary events", () => {
  test("#given an ordinary interactive session #when it starts, ends a turn and quits #then every session event says root", async () => {
    expect(await rolesFor(() => undefined)).toEqual([
      ["session_started", "root"],
      ["turn_completed", "root"],
      ["session_summary", "root"],
    ])
  })

  test("#given a delegated task child (daemon session context) #when it reports #then every session event says child", async () => {
    const roles = await rolesFor((pi) => {
      Object.assign(pi, { sessionContext: { role: "dag_child", task_id: "t-1" } })
    })
    expect(roles).toEqual([
      ["session_started", "child"],
      ["turn_completed", "child"],
      ["session_summary", "child"],
    ])
  })

  test("#given a host whose session context cannot be read #when the session reports #then the role is unknown and nothing throws", async () => {
    const roles = await rolesFor((pi) => {
      Object.defineProperty(pi, "sessionContext", {
        get() {
          throw new Error("session context unavailable")
        },
      })
    })
    expect(roles).toEqual([
      ["session_started", "unknown"],
      ["turn_completed", "unknown"],
      ["session_summary", "unknown"],
    ])
  })

  test("#given the published schemas #when session_role is declared #then all three events share the closed root/child/unknown enum", () => {
    for (const event of SESSION_EVENTS) {
      expect(Reflect.get(OMO_NATIVE_EVENT_SCHEMAS[event], "session_role")).toMatchObject({ values: ["root", "child", "unknown"] })
    }
  })
})
