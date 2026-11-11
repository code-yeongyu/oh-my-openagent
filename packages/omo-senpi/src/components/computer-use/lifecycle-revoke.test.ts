/// <reference types="bun-types" />

// Plan row O1a: computer-control revocation follows the lifecycle of the session that holds the grant, on a
// fused session (agent_end / session_shutdown) and on the hand of a split session, which never receives those
// loop events and learns about its scope's run end and close through a lifecycle source instead.

import { afterEach, describe, expect, test } from "bun:test"
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import type { ChildFactory } from "@oh-my-opencode/senpi-desktop-service"

import type { ComponentContext } from "../../extension/types"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createComputerUseComponent } from "./index"
import type { ComputerLifecycleSource } from "./registration-support"

const FAKE_ENGINE = join(dirname(fileURLToPath(import.meta.url)), "../../../../senpi-desktop-service/test/fake-engine.mjs")
const RECEIVED = "recv "

class HostApi extends FakeExtensionAPI {
  active: string[] = ["read"]
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

/** A hand scope's lifecycle as the host will deliver it: the test fires the scope's run end and close. */
class ScopeLifecycle implements ComputerLifecycleSource {
  readonly #runEnd: Array<() => Promise<void>> = []
  readonly #close: Array<() => Promise<void>> = []
  onRunEnd(handler: () => Promise<void>): void {
    this.#runEnd.push(handler)
  }
  onClose(handler: () => Promise<void>): void {
    this.#close.push(handler)
  }
  async runEnded(): Promise<void> {
    for (const handler of this.#runEnd) await handler()
  }
  async closed(): Promise<void> {
    for (const handler of this.#close) await handler()
  }
}

const children: ChildProcessWithoutNullStreams[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function wireMethod(line: string): string | undefined {
  const message = JSON.parse(line) as { method?: unknown; params?: { message?: unknown } }
  const text = message.method === "engine.log" ? message.params?.message : undefined
  if (typeof text !== "string" || !text.startsWith(RECEIVED)) return undefined
  const request = JSON.parse(text.slice(RECEIVED.length)) as { method?: unknown }
  return typeof request.method === "string" ? request.method : undefined
}

function session(id: string, lifecycle?: ScopeLifecycle) {
  const pi = new HostApi()
  const wire: string[] = []
  const factory: ChildFactory = () => {
    const child = spawn(process.execPath, [FAKE_ENGINE, "--stdio"], { env: { ...process.env, FAKE_ENGINE_DESKTOP: "1" }, stdio: "pipe" })
    children.push(child)
    createInterface({ input: child.stdout }).on("line", (line) => {
      const method = wireMethod(line)
      if (method !== undefined) wire.push(method)
    })
    return child
  }
  const home = mkdtempSync(join(tmpdir(), "omo-lifecycle-revoke-home-"))
  tempDirs.push(home)
  mkdirSync(join(home, ".omo"), { recursive: true })
  writeFileSync(join(home, ".omo", "omo.jsonc"), "{}")
  const context: ComponentContext = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } }
  createComputerUseComponent({
    platform: "linux",
    env: { HOME: home },
    engineChild: () => factory,
    loadSettings: (_cwd, platform) => resolveComputerSettings({}, platform),
    ...(lifecycle === undefined ? {} : { lifecycle: () => lifecycle }),
  }).register(pi, context)
  const hostContext = {
    cwd: "/work",
    model: undefined,
    hasUI: true,
    sessionManager: { getSessionId: () => id, getSessionDir: () => join(home, "sessions") },
    ui: { confirm: () => Promise.resolve(true), notify: () => undefined },
  }
  async function acquire(): Promise<unknown> {
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext)
    const execute = pi.tools.find((tool) => tool.name === "computer")?.execute
    if (typeof execute !== "function") throw new Error("the computer tool is not registered")
    const result = (await execute("call-1", { action: "call", chain: [{ method: "control.acquire", args: [{ reason: "click Run" }] }] }, undefined, undefined, hostContext)) as { details?: { value?: unknown } }
    return result.details?.value
  }
  const count = (method: string) => wire.filter((name) => name === method).length
  return { pi, wire, acquire, count }
}

describe("computer control follows its session's lifecycle (O1a)", () => {
  test("MULTI #given sessions A and B on one host each holding control #when A's run ends #then control.revoke goes to A only and B keeps its grant", async () => {
    // given
    const a = session("session-a")
    const b = session("session-b")
    expect(await a.acquire()).toMatchObject({ active: true })
    expect(await b.acquire()).toMatchObject({ active: true })

    // when
    await a.pi.dispatch("agent_end", { type: "agent_end", messages: [] })

    // then
    expect(a.count("control.revoke")).toBe(1)
    expect(b.count("control.revoke")).toBe(0)
    expect(b.count("session.close")).toBe(0)
  })

  test("#given a hand scope holding control #when the scope's run ends #then control.revoke is sent once, without any agent_end", async () => {
    // given
    const scope = new ScopeLifecycle()
    const hand = session("scope-1", scope)
    expect(await hand.acquire()).toMatchObject({ active: true })

    // when
    await scope.runEnded()

    // then
    expect(hand.count("control.revoke")).toBe(1)
  })

  test("#given a hand scope holding control #when the scope closes #then the grant is revoked before the engine session closes", async () => {
    // given
    const scope = new ScopeLifecycle()
    const hand = session("scope-2", scope)
    expect(await hand.acquire()).toMatchObject({ active: true })

    // when
    await scope.closed()

    // then
    const revoke = hand.wire.indexOf("control.revoke")
    expect(revoke).toBeGreaterThanOrEqual(0)
    expect(hand.wire.indexOf("session.close")).toBeGreaterThan(revoke)
  })

  test("#given a hand scope holding control #when loop events reach its generation #then nothing revokes or closes until the scope's own lifecycle does", async () => {
    // given
    const hand = session("scope-3", new ScopeLifecycle())
    expect(await hand.acquire()).toMatchObject({ active: true })

    // when
    await hand.pi.dispatch("agent_end", { type: "agent_end", messages: [] })
    await hand.pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" })

    // then
    expect(hand.count("control.revoke")).toBe(0)
    expect(hand.count("session.close")).toBe(0)
  })
})
