/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import type { ChildFactory } from "@oh-my-opencode/senpi-desktop-service"

import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createComputerUseComponent } from "./index"

const FAKE_ENGINE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../senpi-desktop-service/test/fake-engine.mjs",
)
const RECEIVED = "recv "

class HostApi extends FakeExtensionAPI {
  active: string[] = ["read", "bash"]
  /** What senpi's permission system enforces for this session (settings -> flag -> default). */
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

const children: ChildProcessWithoutNullStreams[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function homeWith(config: Record<string, unknown> = {}): string {
  const home = mkdtempSync(join(tmpdir(), "omo-computer-control-home-"))
  tempDirs.push(home)
  mkdirSync(join(home, ".omo"), { recursive: true })
  writeFileSync(join(home, ".omo", "omo.jsonc"), JSON.stringify(config))
  return home
}

/** The method the fake engine reports receiving, from one of its `engine.log` lines. */
function receivedMethod(line: string): string | undefined {
  const message: unknown = JSON.parse(line)
  if (typeof message !== "object" || message === null || !("method" in message) || message.method !== "engine.log") return undefined
  if (!("params" in message) || typeof message.params !== "object" || message.params === null) return undefined
  const text = "message" in message.params ? message.params.message : undefined
  if (typeof text !== "string" || !text.startsWith(RECEIVED)) return undefined
  const received: unknown = JSON.parse(text.slice(RECEIVED.length))
  return typeof received === "object" && received !== null && "method" in received && typeof received.method === "string"
    ? received.method
    : undefined
}

function fakeEngine(): { readonly factory: ChildFactory; readonly methods: string[] } {
  const methods: string[] = []
  const factory: ChildFactory = () => {
    const child = spawn(process.execPath, [FAKE_ENGINE, "--stdio"], {
      env: { ...process.env, FAKE_ENGINE_DESKTOP: "1" },
      stdio: "pipe",
    })
    children.push(child)
    createInterface({ input: child.stdout }).on("line", (line) => {
      const method = receivedMethod(line)
      if (method !== undefined) methods.push(method)
    })
    return child
  }
  return { factory, methods }
}

function hostContext() {
  return {
    cwd: "/work",
    model: undefined,
    sessionManager: { getSessionId: () => "session-1", getSessionDir: () => "/tmp/omo-computer-use-test" },
  }
}

function register() {
  const pi = new HostApi()
  const engine = fakeEngine()
  const logger: ComponentLogger = { info() {}, warn() {}, error() {} }
  const context: ComponentContext = { logger, config: { getFlag: () => undefined } }
  createComputerUseComponent({
    platform: "linux",
    env: { HOME: homeWith() },
    engineChild: () => engine.factory,
    loadSettings: (_cwd, platform) => resolveComputerSettings({}, platform),
  }).register(pi, context)
  return { pi, engine }
}

interface ToolResult {
  readonly details?: { readonly value?: unknown }
}

/** Acquires through the registered computer tool with a UI whose confirm is counted and refuses. */
async function acquireCounting(pi: HostApi, prompts: { count: number }, notes: string[]): Promise<unknown> {
  const tool = pi.tools.find((candidate) => candidate.name === "computer")
  const execute = tool?.execute
  if (typeof execute !== "function") throw new Error("the computer tool is not registered")
  const context = {
    ...hostContext(),
    hasUI: true,
    ui: {
      confirm: () => {
        prompts.count += 1
        return Promise.resolve(false)
      },
      notify: (message: string) => notes.push(message),
    },
  }
  const params = { action: "call", chain: [{ method: "control.acquire", args: [{ reason: "click Run" }] }] }
  const result: ToolResult = await execute("call-1", params, undefined, undefined, context)
  return result.details?.value
}

describe("computer control in full access (#10022)", () => {
  test("#given Full access from settings alone (no session flag) #when the model acquires #then it is granted without a confirm, noted, and revoked at agent_end", async () => {
    // given
    const { pi, engine } = register()
    pi.resolvedPreset = "full-access"
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    const prompts = { count: 0 }
    const notes: string[] = []

    // when
    const value = await acquireCounting(pi, prompts, notes)
    await pi.dispatch("agent_end", { type: "agent_end", messages: [] }, hostContext())

    // then
    expect({ value, prompts: prompts.count, notes }).toMatchObject({
      value: { active: true },
      prompts: 0,
      notes: [expect.stringContaining("click Run")],
    })
    expect(engine.methods).toContain("control.grant")
    expect(engine.methods).toContain("control.revoke")
  })

  test("#given another enforced preset although the raw flag says full-access #when the model acquires #then the confirm is asked and a refusal grants nothing", async () => {
    // given
    const { pi, engine } = register()
    pi.resolvedPreset = "workspace"
    pi.setFlag("permission-preset", "full-access")
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    const prompts = { count: 0 }

    // when
    const value = await acquireCounting(pi, prompts, [])

    // then
    expect({ value, prompts: prompts.count }).toMatchObject({ value: { active: false }, prompts: 1 })
    expect(engine.methods).not.toContain("control.grant")
  })
})
