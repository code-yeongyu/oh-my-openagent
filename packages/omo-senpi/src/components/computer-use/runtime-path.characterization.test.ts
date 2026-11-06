/// <reference types="bun-types" />

// E2 characterization (plan P0-06b): today's computer-use runtime on its real path. The registered component,
// its default lazy `#omo-computer-use-runtime` import, the real desktop service and the fake engine child on
// a synthetic desktop. No real desktop is touched. This is a regression baseline only, not C3 policy proof.

import { afterEach, describe, expect, test } from "bun:test"
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import type { ChildFactory } from "@oh-my-opencode/senpi-desktop-service"

import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { fullAccessControlNote } from "./control-confirm"
import { createComputerUseComponent } from "./index"

const FAKE_ENGINE = join(dirname(fileURLToPath(import.meta.url)), "../../../../senpi-desktop-service/test/fake-engine.mjs")
const RECEIVED = "recv "
const FULL_ACCESS_GRANT_REASON = "full access: the session's permission preset consents to desktop input"
/** The engine-side methods this baseline pins; heartbeats and capability reads are timing-dependent noise. */
const PINNED = new Set(["session.open", "session.close", "control.grant", "control.revoke", "keyChord"])

class HostApi extends FakeExtensionAPI {
  active: string[] = ["read", "bash"]
  resolvedPreset: string | undefined = undefined

  getPermissionPreset(): string | undefined {
    return this.resolvedPreset
  }

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

interface Received {
  readonly method: string
  readonly params: unknown
}

const children: ChildProcessWithoutNullStreams[] = []

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
})

function received(line: string): Received | undefined {
  const message: unknown = JSON.parse(line)
  if (typeof message !== "object" || message === null || !("method" in message) || message.method !== "engine.log") return undefined
  if (!("params" in message) || typeof message.params !== "object" || message.params === null) return undefined
  const text = "message" in message.params ? message.params.message : undefined
  if (typeof text !== "string" || !text.startsWith(RECEIVED)) return undefined
  const request: unknown = JSON.parse(text.slice(RECEIVED.length))
  if (typeof request !== "object" || request === null || !("method" in request) || typeof request.method !== "string") return undefined
  return { method: request.method, params: "params" in request ? request.params : undefined }
}

/** The fake engine on a synthetic desktop, with the real engine's admission gate for global input (#10788). */
function fakeEngine(): { readonly factory: ChildFactory; readonly wire: Received[]; readonly spawns: () => number } {
  const wire: Received[] = []
  let spawns = 0
  const factory: ChildFactory = () => {
    spawns += 1
    const child = spawn(process.execPath, [FAKE_ENGINE, "--stdio"], {
      env: { ...process.env, FAKE_ENGINE_DESKTOP: "1", FAKE_ENGINE_GLOBAL_INPUT_GATE: "1" },
      stdio: "pipe",
    })
    children.push(child)
    createInterface({ input: child.stdout }).on("line", (line) => {
      const request = received(line)
      if (request !== undefined) wire.push(request)
    })
    return child
  }
  return { factory, wire, spawns: () => spawns }
}

function hostContext(ui?: { readonly hasUI: boolean; readonly ui?: Record<string, unknown> }) {
  return {
    cwd: "/work",
    model: undefined,
    sessionManager: { getSessionId: () => "session-e2", getSessionDir: () => "/tmp/omo-computer-use-e2" },
    ...(ui ?? {}),
  }
}

function register(preset: string | undefined) {
  const pi = new HostApi()
  pi.resolvedPreset = preset
  const engine = fakeEngine()
  const logger: ComponentLogger = { info() {}, warn() {}, error() {} }
  const context: ComponentContext = { logger, config: { getFlag: () => undefined } }
  // No `loadRuntime`: the component imports `#omo-computer-use-runtime` itself, as the plugin does.
  createComputerUseComponent({
    platform: "linux",
    env: {},
    engineChild: () => engine.factory,
    loadSettings: (_cwd, platform) => resolveComputerSettings({}, platform),
  }).register(pi, context)
  return { pi, engine }
}

interface Outcome {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: string
}

async function callComputer(pi: HostApi, chain: readonly unknown[], context: unknown): Promise<Outcome> {
  const execute = pi.tools.find((candidate) => candidate.name === "computer")?.execute
  if (typeof execute !== "function") throw new Error("the computer tool is not registered")
  try {
    const result: { readonly details?: { readonly value?: unknown } } = await execute("call-e2", { action: "call", chain }, undefined, undefined, context)
    return { ok: true, value: result.details?.value }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const ACQUIRE = [{ method: "control.acquire", args: [{ reason: "press A" }] }]
const PRESS_A = [{ method: "press", args: [["A"]] }]

function pinnedWire(wire: readonly Received[]): string[] {
  return wire
    .filter(({ method }) => PINNED.has(method))
    .map(({ method, params }) => {
      if (method === "control.grant") return `control.grant(${String(Reflect.get(params as object, "reason"))})`
      if (method === "keyChord") return `keyChord(${JSON.stringify(Reflect.get(params as object, "keys"))})`
      return method
    })
}

function uiSurface(prompts: { count: number }, notes: string[]) {
  return {
    hasUI: true,
    ui: {
      confirm: () => {
        prompts.count += 1
        return Promise.resolve(false)
      },
      notify: (message: string) => notes.push(message),
    },
  }
}

describe("E2 characterization: computer-use runtime on its real path (today's behaviour)", () => {
  test("#given a registered component #when the session runs and ends without using the computer #then no runtime loads and no engine starts", async () => {
    // given
    const { pi, engine } = register("full-access")

    // when
    await pi.dispatch("session_start", { type: "session_start" }, hostContext())
    await pi.dispatch("agent_end", { type: "agent_end", messages: [] }, hostContext())
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, hostContext())

    // then
    expect({ spawns: engine.spawns(), wire: engine.wire, active: pi.active }).toEqual({ spawns: 0, wire: [], active: ["read", "bash"] })
  })

  test("#given a registered component #when computer is activated twice #then the runtime loads once, one engine session opens and computer joins the active tools once", async () => {
    // given
    const { pi, engine } = register("full-access")

    // when
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())

    // then
    expect({ spawns: engine.spawns(), wire: pinnedWire(engine.wire), active: pi.active }).toEqual({
      spawns: 1,
      wire: ["session.open"],
      active: ["read", "bash", "computer"],
    })
  })

  test("#given full access with a UI #when the model acquires foreground control and presses A, then the run and the session end #then control is granted without a confirm, noted, A reaches the engine, and agent_end revokes", async () => {
    // given
    const { pi, engine } = register("full-access")
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    const prompts = { count: 0 }
    const notes: string[] = []
    const context = hostContext(uiSurface(prompts, notes))

    // when
    const acquire = await callComputer(pi, ACQUIRE, context)
    const press = await callComputer(pi, PRESS_A, context)
    await pi.dispatch("agent_end", { type: "agent_end", messages: [] }, hostContext())
    const atRunEnd = pinnedWire(engine.wire)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, hostContext())

    // then
    expect({ acquire, pressed: press.ok, prompts: prompts.count, notes }).toMatchObject({
      acquire: { ok: true, value: { active: true } },
      pressed: true,
      prompts: 0,
      notes: [fullAccessControlNote("press A")],
    })
    expect({ atRunEnd, atShutdown: pinnedWire(engine.wire) }).toEqual({
      atRunEnd: ["session.open", "control.grant(press A)", 'keyChord(["A"])', "control.revoke"],
      atShutdown: ["session.open", "control.grant(press A)", 'keyChord(["A"])', "control.revoke", "session.close"],
    })
  })

  test("#given full access without a UI #when the model acquires and presses A #then the acquire is not granted, yet the press is admitted by the service's own full-access grant, and agent_end revokes it", async () => {
    // given
    const { pi, engine } = register("full-access")
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    const context = hostContext({ hasUI: false })

    // when
    const acquire = await callComputer(pi, ACQUIRE, context)
    const press = await callComputer(pi, PRESS_A, context)
    await pi.dispatch("agent_end", { type: "agent_end", messages: [] }, hostContext())
    const atRunEnd = pinnedWire(engine.wire)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, hostContext())

    // then
    expect({ acquire, pressed: press.ok }).toMatchObject({ acquire: { ok: true, value: { active: false } }, pressed: true })
    const granted = ["session.open", `control.grant(${FULL_ACCESS_GRANT_REASON})`, 'keyChord(["A"])', "control.revoke"]
    expect({ atRunEnd, atShutdown: pinnedWire(engine.wire) }).toEqual({ atRunEnd: granted, atShutdown: [...granted, "session.close"] })
  })

  test("#given no full access and no UI #when the model acquires and presses A #then nothing is granted and the press comes back as a COMPUTER_CONTROL_REQUIRED result", async () => {
    // given
    const { pi, engine } = register(undefined)
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    const context = hostContext({ hasUI: false })

    // when
    const acquire = await callComputer(pi, ACQUIRE, context)
    const press = await callComputer(pi, PRESS_A, context)
    await pi.dispatch("agent_end", { type: "agent_end", messages: [] }, hostContext())
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, hostContext())

    // then
    expect({ acquire, press }).toMatchObject({
      acquire: { ok: true, value: { active: false } },
      press: { ok: true, value: { code: "COMPUTER_CONTROL_REQUIRED" } },
    })
    expect(pinnedWire(engine.wire)).toEqual(["session.open", 'keyChord(["A"])', "session.close"])
  })
})
