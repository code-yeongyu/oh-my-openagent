/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import type { ChildFactory } from "@oh-my-opencode/senpi-desktop-service"

import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { COMPUTER_UNAVAILABLE, createComputerUseComponent } from "./index"

const FAKE_ENGINE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../senpi-desktop-service/test/fake-engine.mjs",
)
const RECEIVED = "recv "
const HANG_GUARD_MS = 10_000

class HostApi extends FakeExtensionAPI {
  active: string[] = ["read", "bash"]
  readonly executed: string[] = []

  getActiveTools(): string[] {
    return [...this.active]
  }

  setActiveTools(names: string[]): void {
    this.active = [...names]
  }

  async executeTool(toolName: string): Promise<unknown> {
    this.executed.push(toolName)
    return { content: [] }
  }
}

interface EngineLog {
  readonly factory: ChildFactory
  readonly methods: string[]
  nth(method: string, n: number): Promise<void>
}

const children: ChildProcessWithoutNullStreams[] = []

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
})

function fakeEngine(): EngineLog {
  const methods: string[] = []
  const waiters: Array<{ method: string; n: number; resolve: () => void }> = []
  const factory: ChildFactory = () => {
    const child = spawn(process.execPath, [FAKE_ENGINE, "--stdio"], {
      env: { ...process.env, FAKE_ENGINE_DESKTOP: "1" },
      stdio: "pipe",
    })
    children.push(child)
    createInterface({ input: child.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as { method?: string; params?: { message?: unknown } }
      const text = message.params?.message
      if (message.method !== "engine.log" || typeof text !== "string" || !text.startsWith(RECEIVED)) return
      const method = (JSON.parse(text.slice(RECEIVED.length)) as { method: string }).method
      methods.push(method)
      const count = methods.filter((seen) => seen === method).length
      for (const waiter of waiters) if (waiter.method === method && waiter.n === count) waiter.resolve()
    })
    return child
  }
  return {
    factory,
    methods,
    nth: (method, n) =>
      new Promise((resolve, reject) => {
        if (methods.filter((seen) => seen === method).length >= n) return resolve()
        const timer = setTimeout(() => reject(new Error(`waited ${HANG_GUARD_MS}ms for ${method} #${n}`)), HANG_GUARD_MS)
        waiters.push({ method, n, resolve: () => (clearTimeout(timer), resolve()) })
      }),
  }
}

function logger(): ComponentLogger & { readonly warnings: string[] } {
  const warnings: string[] = []
  return { warnings, info() {}, warn: (message) => void warnings.push(message), error() {} }
}

function componentContext(log: ComponentLogger): ComponentContext {
  return { logger: log, config: { getFlag: () => undefined } }
}

function register(options: {
  readonly block?: Record<string, unknown>
  readonly platform?: string
  readonly engineChild?: ChildFactory
  readonly pi?: FakeExtensionAPI
}) {
  const pi = options.pi ?? new HostApi()
  const log = logger()
  const engine = fakeEngine()
  const component = createComputerUseComponent({
    platform: options.platform ?? "linux",
    engineChild: () => options.engineChild ?? engine.factory,
    loadSettings: (_cwd, platform) => resolveComputerSettings(options.block, platform),
  })
  component.register(pi, componentContext(log))
  return { pi, log, engine }
}

function hostContext() {
  return {
    cwd: "/work",
    model: undefined,
    sessionManager: { getSessionId: () => "session-1", getSessionDir: () => "/tmp/omo-computer-use-test" },
  }
}

function commandContext() {
  const notices: string[] = []
  return { notices, ctx: { ...hostContext(), ui: { notify: (message: string) => void notices.push(message) } } }
}

async function runCommand(pi: FakeExtensionAPI, args: string): Promise<string[]> {
  const command = pi.commands.find((registration) => registration.name === "computer")
  if (command === undefined) throw new Error("/computer is not registered")
  const { notices, ctx } = commandContext()
  await (command.options.handler as (args: string, ctx: unknown) => Promise<void>)(args, ctx)
  return notices
}

function tool(pi: FakeExtensionAPI, name: string): Record<string, unknown> | undefined {
  return pi.tools.find((registered) => registered.name === name)
}

type Parser = (input: Record<string, unknown>, cwd: string) => Array<{ patterns: readonly string[] }>

describe("computer-use component", () => {
  test("#given a supported host #when registered #then a search-exposed computer tool with its prelude and tiers exists and no engine starts", async () => {
    // given / when
    const { pi, engine } = register({})
    const computer = tool(pi, "computer")

    // then
    expect(computer?.exposure).toBe("search")
    expect(computer?.kernelPrelude).toBeDefined()
    const parse = computer?.permissionParser as Parser
    expect(parse({ action: "call", chain: [{ method: "click", args: [1, 2] }] }, "/work")[0]?.patterns).toEqual(["exec"])
    expect(parse({ action: "call", chain: [{ method: "screenshot" }] }, "/work")[0]?.patterns).toEqual(["read"])
    expect(engine.methods).toEqual([])
  })

  test("#given an unsupported host #when registered #then no tool exists and /computer reports it unavailable", async () => {
    // given / when
    const { pi } = register({ platform: "freebsd" })

    // then
    expect(pi.tools).toEqual([])
    expect(await runCommand(pi, "on")).toEqual([COMPUTER_UNAVAILABLE])
  })

  test("#given computer.enabled false #when registered #then no tool, no skill, and /computer reports it unavailable", async () => {
    // given / when
    const { pi } = register({ block: { enabled: false } })

    // then
    expect(pi.tools).toEqual([])
    expect(await pi.dispatch("resources_discover", {})).toEqual([])
    expect(await runCommand(pi, "status")).toEqual([COMPUTER_UNAVAILABLE])
  })

  test("#given cua_adapter #when registered #then computer_actions exists with its own tiers, and not otherwise", async () => {
    // given / when
    const withAdapter = register({ block: { cuaAdapter: true } }).pi
    const without = register({}).pi

    // then
    const parse = tool(withAdapter, "computer_actions")?.permissionParser as Parser | undefined
    expect(parse?.({ action: "screenshot" }, "/work")[0]?.patterns).toEqual(["read"])
    expect(parse?.({ action: "batch", actions: [{ action: "screenshot" }, { action: "click", x: 1, y: 2 }] }, "/work")[0]?.patterns).toEqual(["exec"])
    expect(tool(without, "computer_actions")).toBeUndefined()
  })

  test("#given a host without getActiveTools/setActiveTools/executeTool #when registered #then it warns and registers nothing", async () => {
    // given / when
    const { pi, log } = register({ pi: new FakeExtensionAPI() })

    // then
    expect(pi.tools).toEqual([])
    expect(log.warnings.some((message) => message.includes("computer-use skipped"))).toBe(true)
  })

  test("#given an invalid computer block #when registered #then it warns and registers nothing", async () => {
    // given / when
    const { pi, log } = register({ block: { maxWidth: -1 } })

    // then
    expect(pi.tools).toEqual([])
    expect(log.warnings.some((message) => message.includes("invalid computer settings"))).toBe(true)
  })

  test("#given the tool is activated #when tool_activated fires #then the engine session opens, the stop chord arms, and the tool stays active", async () => {
    // given
    const { pi, engine } = register({})
    const host = pi as HostApi

    // when
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    await engine.nth("stopPath.start", 1)

    // then
    expect(engine.methods.filter((method) => method === "session.open")).toHaveLength(1)
    expect(host.active).toContain("computer")
    expect(await runCommand(pi, "status")).toEqual([expect.stringContaining("engine: ready\nprelude: active")])
  })

  test("#given another tool activates #when tool_activated fires #then no engine starts", async () => {
    // given
    const { pi, engine } = register({})

    // when
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["x_search"] }, hostContext())

    // then
    expect(engine.methods).toEqual([])
    expect(await runCommand(pi, "status")).toEqual([expect.stringContaining("engine: not started\nprelude: inactive")])
  })

  test("#given an active session #when /computer off runs #then the engine session closes and the tool leaves the active set", async () => {
    // given
    const { pi, engine } = register({})
    const host = pi as HostApi
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    await engine.nth("stopPath.start", 1)

    // when
    await runCommand(pi, "off")
    await engine.nth("session.close", 1)

    // then
    expect(host.active).not.toContain("computer")
  })

  test("#given cua_adapter #when /computer on then off runs #then computer_actions joins and leaves the active set with computer", async () => {
    // given
    const { pi, engine } = register({ block: { cuaAdapter: true } })
    const host = pi as HostApi

    // when
    await runCommand(pi, "on")
    await engine.nth("stopPath.start", 1)
    const whileOn = host.getActiveTools()
    await runCommand(pi, "off")
    await engine.nth("session.close", 1)

    // then
    expect(whileOn).toEqual(expect.arrayContaining(["read", "bash", "computer", "computer_actions"]))
    expect(host.getActiveTools()).toEqual(["read", "bash"])
  })

  test("#given no cua_adapter #when /computer on runs #then only computer is activated", async () => {
    // given
    const { pi, engine } = register({})
    const host = pi as HostApi

    // when
    await runCommand(pi, "on")
    await engine.nth("stopPath.start", 1)

    // then
    expect(host.getActiveTools()).toEqual(["read", "bash", "computer"])
  })

  test("#given cua_adapter #when registered #then both tools publish dev's root-object parameter schemas byte for byte", () => {
    // given: the #9049 root-object schemas as dev published them; Anthropic tool search rejects a root union
    const published = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "published-parameters.fixture.json"), "utf8"),
    ) as Record<string, unknown>

    // when
    const { pi } = register({ block: { cuaAdapter: true } })

    // then
    for (const name of ["computer", "computer_actions"]) {
      const parameters = tool(pi, name)?.parameters as { type?: unknown } | undefined
      expect(parameters?.type).toBe("object")
      expect(JSON.stringify(parameters)).toBe(JSON.stringify(published[name]))
    }
  })

  test("#given a registered component #when only startup events fire #then the runtime loads on first use and once", async () => {
    // given
    let loads = 0
    const pi = new HostApi()
    const engine = fakeEngine()
    createComputerUseComponent({
      platform: "linux",
      engineChild: () => engine.factory,
      loadSettings: (_cwd, platform) => resolveComputerSettings({ cuaAdapter: true }, platform),
      loadRuntime: () => {
        loads += 1
        return import("#omo-computer-use-runtime")
      },
    }).register(pi, componentContext(logger()))

    // when: everything a session that never uses the desktop dispatches
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, hostContext())
    await pi.dispatch("resources_discover", {})
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["x_search"] }, hostContext())
    await pi.dispatch("tool_execution_start", { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: {} })
    await pi.dispatch("tool_execution_end", { type: "tool_execution_end", toolCallId: "c1", toolName: "read", isError: false, result: {} })
    const beforeUse = loads
    const status = await runCommand(pi, "status")
    const execute = tool(pi, "computer")?.execute as (...args: unknown[]) => Promise<{ content: Array<{ text?: string }> }>
    const closed = await execute("call-1", { action: "close" }, undefined, undefined, hostContext())

    // then
    expect(beforeUse).toBe(0)
    expect(loads).toBe(1)
    expect(status).toEqual([expect.stringContaining("Computer use: enabled=true active=false engine=not started")])
    expect(closed.content[0]?.text).toBe("Closed the desktop session.")
    expect(engine.methods).toEqual([])
  })

  test("#given the runtime never loaded #when the session shuts down #then it stays unloaded", async () => {
    // given
    let loads = 0
    const pi = new HostApi()
    createComputerUseComponent({
      platform: "linux",
      engineChild: () => fakeEngine().factory,
      loadSettings: (_cwd, platform) => resolveComputerSettings(undefined, platform),
      loadRuntime: () => {
        loads += 1
        return import("#omo-computer-use-runtime")
      },
    }).register(pi, componentContext(logger()))

    // when
    await pi.dispatch("session_shutdown", {})

    // then
    expect(loads).toBe(0)
  })

  test("#given an enabled host #when resources_discover fires #then the computer skill path is contributed", async () => {
    // given
    const { pi } = register({})

    // when
    const [contribution] = (await pi.dispatch("resources_discover", {})) as Array<{ skillPaths: string[] }>

    // then
    expect(contribution?.skillPaths).toHaveLength(1)
    expect(existsSync(contribution?.skillPaths[0] ?? "")).toBe(true)
  })
})
