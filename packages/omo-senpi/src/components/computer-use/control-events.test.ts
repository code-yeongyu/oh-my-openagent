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

function fakeEngine(): { readonly factory: ChildFactory; readonly methods: string[] } {
  const methods: string[] = []
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
      methods.push((JSON.parse(text.slice(RECEIVED.length)) as { method: string }).method)
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

describe("computer control revocation events (#9651 B5b)", () => {
  test("#given an active session #when agent_end fires #then the engine receives control.revoke", async () => {
    // given
    const { pi, engine } = register()
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())

    // when
    await pi.dispatch("agent_end", { type: "agent_end", messages: [] }, hostContext())

    // then
    expect(engine.methods).toContain("control.revoke")
  })

  test("#given an active session #when session_shutdown fires #then the engine receives control.revoke before session.close", async () => {
    // given
    const { pi, engine } = register()
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())

    // when
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, hostContext())

    // then
    const control = engine.methods.indexOf("control.revoke")
    const close = engine.methods.indexOf("session.close")
    expect({ control, close }).toEqual({ control: expect.any(Number), close: expect.any(Number) })
    expect(control).toBeGreaterThanOrEqual(0)
    expect(close).toBeGreaterThan(control)
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
