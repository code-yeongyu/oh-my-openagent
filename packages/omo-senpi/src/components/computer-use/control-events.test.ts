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

/** Grants through the real path: the registered computer tool asks a confirm that answers yes. */
async function grantControl(pi: HostApi): Promise<unknown> {
  const tool = pi.tools.find((candidate) => candidate.name === "computer")
  const execute = tool?.execute
  if (typeof execute !== "function") throw new Error("the computer tool is not registered")
  const confirmingContext = { ...hostContext(), hasUI: true, ui: { confirm: () => Promise.resolve(true) } }
  const params = { action: "call", chain: [{ method: "control.acquire", args: [{ reason: "click Run" }] }] }
  const result: ToolResult = await execute("call-1", params, undefined, undefined, confirmingContext)
  return result.details?.value
}

describe("computer control revocation events (#9651 B5b)", () => {
  test("#given a session holding the grant #when agent_end fires #then the engine receives control.revoke", async () => {
    // given
    const { pi, engine } = register()
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    expect(await grantControl(pi)).toMatchObject({ active: true })

    // when
    await pi.dispatch("agent_end", { type: "agent_end", messages: [] }, hostContext())

    // then
    expect(engine.methods).toContain("control.revoke")
  })

  test("#given a session holding the grant #when session_shutdown fires #then the engine receives control.revoke before session.close", async () => {
    // given
    const { pi, engine } = register()
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    expect(await grantControl(pi)).toMatchObject({ active: true })

    // when
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, hostContext())

    // then
    const control = engine.methods.indexOf("control.revoke")
    const close = engine.methods.indexOf("session.close")
    expect(control).toBeGreaterThanOrEqual(0)
    expect(close).toBeGreaterThan(control)
  })

  test("#given an active session without a grant #when it shuts down #then no control.revoke is sent", async () => {
    // given: a revoke with nothing granted would only add a no-op event to the engine's audit
    const { pi, engine } = register()
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, hostContext())

    // then: the engine was reached (session.close) yet saw no revoke
    expect(engine.methods).toContain("session.close")
    expect(engine.methods).not.toContain("control.revoke")
  })

  test("#given a runtime that never started #when agent_end fires #then no engine is spawned to revoke", async () => {
    // given
    const { pi, engine } = register()

    // when
    await pi.dispatch("agent_end", { type: "agent_end", messages: [] }, hostContext())

    // then
    expect(engine.methods).toEqual([])
    expect(children).toHaveLength(0)
  })
})
