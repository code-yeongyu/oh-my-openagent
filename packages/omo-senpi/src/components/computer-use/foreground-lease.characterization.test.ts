/// <reference types="bun-types" />

// Characterization pin (P0-06g / X16): today's foreground-control acquire, release and stop-chord behaviour.

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
import { CONTROL_CONFIRM_TITLE, controlConfirmBody } from "./control-confirm"
import { createComputerUseComponent } from "./index"

const FAKE_ENGINE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../senpi-desktop-service/test/fake-engine.mjs",
)
const RECEIVED = "recv "
const GRANTED_AT = "2026-10-11T00:00:00.000Z"
const NON_MACOS_DEFAULT_STOP_CHORD = "ctrl+alt+shift+escape"

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

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-foreground-lease-home-"))
  tempDirs.push(dir)
  mkdirSync(join(dir, ".omo"), { recursive: true })
  writeFileSync(join(dir, ".omo", "omo.jsonc"), "{}")
  return dir
}

interface Received {
  readonly method: string
  readonly params: unknown
}

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

/**
 * The fake engine with its wire log. A request is logged before the engine answers it, and an answer
 * arrives after its own log line on the same stream, so an awaited call's request is always recorded.
 */
function fakeEngine(env: Record<string, string>): { readonly factory: ChildFactory; readonly wire: Received[] } {
  const wire: Received[] = []
  const factory: ChildFactory = () => {
    const child = spawn(process.execPath, [FAKE_ENGINE, "--stdio"], {
      env: { ...process.env, FAKE_ENGINE_DESKTOP: "1", ...env },
      stdio: "pipe",
    })
    children.push(child)
    createInterface({ input: child.stdout }).on("line", (line) => {
      const request = received(line)
      if (request !== undefined) wire.push(request)
    })
    return child
  }
  return { factory, wire }
}

function hostContext() {
  return {
    cwd: "/work",
    model: undefined,
    sessionManager: { getSessionId: () => "session-1", getSessionDir: () => "/tmp/omo-foreground-lease-test" },
  }
}

interface Confirms {
  readonly asked: { readonly title: string; readonly body: string; readonly timeout: unknown }[]
  answer: boolean
}

interface ToolResult {
  readonly isError?: boolean
  readonly details?: { readonly value?: unknown }
}

function register(engineEnv: Record<string, string> = {}) {
  const pi = new HostApi()
  const engine = fakeEngine(engineEnv)
  const logger: ComponentLogger = { info() {}, warn() {}, error() {} }
  const context: ComponentContext = { logger, config: { getFlag: () => undefined } }
  createComputerUseComponent({
    platform: "linux",
    env: { HOME: home() },
    engineChild: () => engine.factory,
    loadSettings: (_cwd, platform) => resolveComputerSettings({}, platform),
  }).register(pi, context)
  const confirms: Confirms = { asked: [], answer: true }
  const notes: string[] = []
  const uiContext = (hasUI: boolean) => ({
    ...hostContext(),
    hasUI,
    ui: {
      confirm: (title: string, body: string, options?: { timeout?: unknown }) => {
        confirms.asked.push({ title, body, timeout: options?.timeout })
        return Promise.resolve(confirms.answer)
      },
      notify: (message: string) => notes.push(message),
    },
  })

  async function call(method: string, args: unknown[] = [], hasUI = true): Promise<ToolResult> {
    const execute = pi.tools.find((candidate) => candidate.name === "computer")?.execute
    if (typeof execute !== "function") throw new Error("the computer tool is not registered")
    return (await execute("call-1", { action: "call", chain: [{ method, args }] }, undefined, undefined, uiContext(hasUI))) as ToolResult
  }

  async function command(args: string): Promise<string[]> {
    const handler = pi.commands.find((registration) => registration.name === "computer")?.options.handler
    if (typeof handler !== "function") throw new Error("/computer is not registered")
    const before = notes.length
    await handler(args, uiContext(true))
    return notes.slice(before)
  }

  const methods = () => engine.wire.map((request) => request.method)
  const count = (method: string) => methods().filter((name) => name === method).length
  return { pi, engine, confirms, notes, call, command, methods, count }
}

async function activate(pi: HostApi): Promise<void> {
  await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext())
}

describe("foreground-control lease in fused computer use (X16 characterization)", () => {
  describe("acquire", () => {
    test("#given an activated session #when the model acquires and the human approves #then the confirm is asked once and control.grant returns the held lease", async () => {
      // given
      const session = register()
      await activate(session.pi)

      // when
      const result = await session.call("control.acquire", [{ reason: "click Run" }])

      // then
      expect(result.details?.value).toEqual({ active: true, reason: "click Run", grantedAt: GRANTED_AT })
      expect(session.confirms.asked).toHaveLength(1)
      expect(session.confirms.asked[0]?.title).toBe(CONTROL_CONFIRM_TITLE)
      expect(session.confirms.asked[0]?.body).toBe(controlConfirmBody("click Run"))
      expect(typeof session.confirms.asked[0]?.timeout).toBe("number")
      const grantIndex = session.methods().indexOf("control.grant")
      expect(session.methods().lastIndexOf("control.state", grantIndex)).toBeGreaterThanOrEqual(0)
      expect(session.count("control.grant")).toBe(1)
      const grant = session.engine.wire.find((request) => request.method === "control.grant")
      expect(grant?.params).toMatchObject({ reason: "click Run", confirmationId: expect.any(String) })
    })

    test("#given a held lease #when the model acquires again #then the held lease is returned without a second confirm or grant", async () => {
      // given
      const session = register()
      await activate(session.pi)
      await session.call("control.acquire", [{ reason: "click Run" }])

      // when
      const again = await session.call("control.acquire", [{ reason: "type a name" }])

      // then
      expect(again.details?.value).toEqual({ active: true, reason: "click Run", grantedAt: GRANTED_AT })
      expect(session.confirms.asked).toHaveLength(1)
      expect(session.count("control.grant")).toBe(1)
    })

    test("#given the human refuses #when the model acquires #then it gets an inactive lease and no grant is sent", async () => {
      // given
      const session = register()
      session.confirms.answer = false
      await activate(session.pi)

      // when
      const result = await session.call("control.acquire", [{ reason: "click Run" }])

      // then
      expect(result.details?.value).toEqual({ active: false })
      expect(session.confirms.asked).toHaveLength(1)
      expect(session.count("control.grant")).toBe(0)
    })

    test("#given a headless context #when the model acquires #then nobody is asked and no grant is sent", async () => {
      // given
      const session = register()
      await activate(session.pi)

      // when
      const result = await session.call("control.acquire", [{ reason: "click Run" }], false)

      // then
      expect(result.details?.value).toEqual({ active: false })
      expect(session.confirms.asked).toHaveLength(0)
      expect(session.count("control.grant")).toBe(0)
    })

    test("#given a blank reason #when the model acquires #then the call is rejected before anyone is asked", async () => {
      // given
      const session = register()
      await activate(session.pi)

      // when: settled plainly; `expect(p).rejects` right after the awaited engine replies never wakes on Windows
      // and wedges the whole bun test process (#11815, oven-sh/bun#37189)
      const failure = await session.call("control.acquire", [{ reason: "   " }]).then(
        () => undefined,
        (error: unknown) => error,
      )

      // then
      expect(failure).toBeInstanceOf(Error)
      expect(failure).toMatchObject({ message: expect.stringContaining("control.acquire requires a non-empty reason") })
      expect(session.confirms.asked).toHaveLength(0)
      expect(session.count("control.grant")).toBe(0)
    })
  })

  describe("release", () => {
    test("#given a held lease #when the model releases it #then control.revoke is sent, the state reads inactive, and agent_end sends no second revoke", async () => {
      // given
      const session = register()
      await activate(session.pi)
      await session.call("control.acquire", [{ reason: "click Run" }])

      // when
      await session.call("control.release")
      const state = await session.call("control.state")
      await session.pi.dispatch("agent_end", { type: "agent_end", messages: [] }, hostContext())

      // then
      expect(state.details?.value).toEqual({ active: false })
      expect(session.count("control.revoke")).toBe(1)
    })

    test("#given a held lease #when the agent run ends #then the lease is revoked and the next acquire asks the human again", async () => {
      // given
      const session = register()
      await activate(session.pi)
      await session.call("control.acquire", [{ reason: "click Run" }])

      // when
      await session.pi.dispatch("agent_end", { type: "agent_end", messages: [] }, hostContext())
      const next = await session.call("control.acquire", [{ reason: "click Save" }])

      // then
      expect(session.count("control.revoke")).toBe(1)
      expect(next.details?.value).toEqual({ active: true, reason: "click Save", grantedAt: GRANTED_AT })
      expect(session.confirms.asked).toHaveLength(2)
      expect(session.count("control.grant")).toBe(2)
    })

    test("#given a held lease #when the session shuts down #then control.revoke precedes session.close", async () => {
      // given
      const session = register()
      await activate(session.pi)
      await session.call("control.acquire", [{ reason: "click Run" }])

      // when
      await session.pi.dispatch("session_shutdown", { type: "session_shutdown" }, hostContext())

      // then
      const revoke = session.methods().indexOf("control.revoke")
      expect(revoke).toBeGreaterThanOrEqual(0)
      expect(session.methods().indexOf("session.close")).toBeGreaterThan(revoke)
    })
  })

  describe("stop chord", () => {
    test("#given a session #when computer use activates and is used #then the default stop chord is armed exactly once", async () => {
      // given
      const session = register()

      // when
      await activate(session.pi)
      await session.call("control.state")

      // then
      const armed = session.engine.wire.filter((request) => request.method === "stopPath.start")
      expect(armed).toEqual([{ method: "stopPath.start", params: { chord: NON_MACOS_DEFAULT_STOP_CHORD } }])
    })

    test("#given a held lease #when the user stops #then the lease drops, a new grant is refused while stopped, and after resume the human can grant again", async () => {
      // given: the engine gates grants on the stop latch, as the real engine does
      const session = register({ FAKE_ENGINE_GLOBAL_INPUT_GATE: "1" })
      await activate(session.pi)
      await session.call("control.acquire", [{ reason: "click Run" }])

      // when
      const stopNotes = await session.command("stop")
      const stopped = await session.call("control.state")
      const refused = await session.call("control.acquire", [{ reason: "click Run" }])
      const resumeNotes = await session.command("resume")
      const regranted = await session.call("control.acquire", [{ reason: "click Run" }])

      // then
      expect(stopNotes).toEqual([expect.stringMatching(/^Computer input stopped:/)])
      expect(session.engine.wire.find((request) => request.method === "stopPath.stop")?.params).toEqual({ source: "host-relay" })
      expect(stopped.details?.value).toEqual({ active: false })
      expect(refused.isError).toBe(true)
      expect(refused.details?.value).toMatchObject({ code: "COMPUTER_SUSPENDED" })
      expect(resumeNotes).toEqual([expect.stringMatching(/^Computer input resumed:/)])
      expect(regranted.details?.value).toEqual({ active: true, reason: "click Run", grantedAt: GRANTED_AT })
      expect(session.confirms.asked).toHaveLength(3)
      expect(session.count("control.grant")).toBe(3)
    })
  })
})
