/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import { type ChildFactory, DesktopEngineUnavailableError } from "@oh-my-opencode/senpi-desktop-service"

import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type {
  ComputerUseTelemetryObservation,
  ComputerUseTelemetryObservers,
} from "../telemetry/omo-native-computer-use"
import { createComputerUseComponent } from "./index"

const FAKE_ENGINE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../senpi-desktop-service/test/fake-engine.mjs",
)
const children: ChildProcessWithoutNullStreams[] = []

class HostApi extends FakeExtensionAPI {
  active: string[] = ["read", "bash"]

  getActiveTools(): string[] {
    return [...this.active]
  }

  setActiveTools(names: string[]): void {
    this.active = [...names]
  }

  async executeTool(): Promise<unknown> {
    return { content: [] }
  }
}

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
})

function fakeEngine(): {
  readonly factory: ChildFactory
  stopped(): Promise<void>
} {
  let resolveStopped: () => void = () => undefined
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve
  })
  return {
    factory: () => {
      const child = spawn(process.execPath, [FAKE_ENGINE, "--stdio"], {
        env: { ...process.env, FAKE_ENGINE_DESKTOP: "1" },
        stdio: "pipe",
      })
      children.push(child)
      createInterface({ input: child.stdout }).on("line", (line) => {
        const message = JSON.parse(line) as { method?: string; params?: { message?: unknown } }
        const text = message.params?.message
        if (message.method === "engine.log" && typeof text === "string" && text.includes('"method":"stopPath.start"')) {
          resolveStopped()
        }
      })
      return child
    },
    stopped: () => stopped,
  }
}

function context() {
  return {
    cwd: "/work",
    model: undefined,
    sessionManager: { getSessionId: () => "session-1", getSessionDir: () => "/tmp/omo-computer-use-test" },
  }
}

function recorder(): {
  readonly observations: ComputerUseTelemetryObservation[]
  readonly observers: ComputerUseTelemetryObservers
} {
  const observations: ComputerUseTelemetryObservation[] = []
  return {
    observations,
    observers: {
      publish: (observation) => void observations.push(observation),
      subscribe: () => () => undefined,
    },
  }
}

function register(engineChild: ChildFactory, observers: ComputerUseTelemetryObservers): FakeExtensionAPI {
  const pi = new HostApi()
  const logger: ComponentLogger = { info() {}, warn() {}, error() {} }
  const componentContext: ComponentContext = { logger, config: { getFlag: () => undefined } }
  createComputerUseComponent({
    platform: "linux",
    engineChild: () => engineChild,
    loadSettings: (_cwd, platform) => resolveComputerSettings(undefined, platform),
    telemetryObservers: observers,
  }).register(pi, componentContext)
  return pi
}

async function command(pi: FakeExtensionAPI, args: string): Promise<void> {
  const registration = pi.commands.find((item) => item.name === "computer")
  if (registration === undefined) throw new Error("/computer is not registered")
  await (registration.options.handler as (value: string, ctx: unknown) => Promise<void>)(args, {
    ...context(),
    ui: { notify() {} },
  })
}

describe("computer-use component telemetry", () => {
  test("#given no engine binary #when the tool activates #then native-unavailable is observed", async () => {
    const telemetry = recorder()
    const missing: ChildFactory = () => {
      throw new DesktopEngineUnavailableError({
        code: "native-unavailable",
        host: "linux-x64",
        attemptedPaths: [],
        message: "No senpi-desktop-engine binary is available for linux-x64.",
        cause: "none",
      })
    }
    const pi = register(missing, telemetry.observers)
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context())

    await expect(
      pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, context()),
    ).rejects.toThrow("native-unavailable")

    expect(telemetry.observations).toEqual([{
      kind: "engine_error",
      sessionId: "session-1",
      code: "native-unavailable",
      platform: "linux",
      backend: "unavailable",
    }])
  })

  test("#given telemetry observers #when a tool activates and the command disables it #then both transitions fire once", async () => {
    const telemetry = recorder()
    const engine = fakeEngine()
    const pi = register(engine.factory, telemetry.observers)

    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, context())
    await engine.stopped()
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, context())
    await command(pi, "off")

    expect(telemetry.observations).toEqual([
      {
        kind: "activation",
        sessionId: "session-1",
        active: true,
        source: "tool_call",
        platform: "linux",
        backend: "fake",
      },
      {
        kind: "activation",
        sessionId: "session-1",
        active: false,
        source: "command_off",
        platform: "linux",
        backend: "fake",
      },
    ])
  })

  test("#given a denied computer call #when its tool result message ends #then the tier denial is observed", async () => {
    const telemetry = recorder()
    const engine = fakeEngine()
    const pi = register(engine.factory, telemetry.observers)

    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context())
    const computer = pi.tools.find((tool) => tool.name === "computer")
    const parsePermission = computer?.permissionParser
    if (typeof parsePermission !== "function") throw new Error("computer permission parser is unavailable")
    parsePermission({ action: "run", code: "private typed text" }, "/work")
    await pi.dispatch("tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "computer",
      isError: true,
      result: {
        content: [{ type: "text", text: "The user has specified a rule which prevents you from using this specific tool call." }],
      },
    })

    expect(telemetry.observations).toEqual([{
      kind: "permission_denied",
      sessionId: "session-1",
      scope: "tier",
      permission: "exec",
      platform: "linux",
      backend: "unavailable",
    }])
    expect(JSON.stringify(telemetry.observations)).not.toContain("private typed text")
  })
})
