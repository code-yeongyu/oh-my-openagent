/// <reference types="bun-types" />

// Plan row O1d (C4: no live view, one screenshot per tool call). The fake engine's screen changes between captures
// (markers 1, 2, 3). Each computer call's result must carry exactly that call's image, under today's capture caps,
// and survive the hand wire (the engine's remote protocol encoding) unchanged; nothing streams the screen.

import { afterEach, describe, expect, test } from "bun:test"
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"
import { inflateSync } from "node:zlib"

import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import type { ChildFactory } from "@oh-my-opencode/senpi-desktop-service"

import type { ComponentContext } from "../../extension/types"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createComputerUseComponent } from "./index"

const FAKE_ENGINE = join(dirname(fileURLToPath(import.meta.url)), "../../../../senpi-desktop-service/test/fake-engine.mjs")
const RECEIVED = "recv "
const senpiDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const wire = (await import(pathToFileURL(join(senpiDist, "..", "..", "..", "@earendil-works", "pi-agent-core", "dist", "index.js")).href)) as {
  encodeRemoteMessage(message: unknown): Uint8Array
  decodeRemoteMessage(payload: Uint8Array): { readonly kind: string; readonly result?: { readonly content: ReadonlyArray<Part> } }
}

interface Part { readonly type: string; readonly data?: string; readonly mimeType?: string; readonly text?: string }

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

const children: ChildProcessWithoutNullStreams[] = []
const tempDirs: string[] = []
afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The pixel of a 1x1 8-bit grayscale PNG (the fake engine's marker), read from its IDAT chunk. */
function markerOf(base64: string): number {
  const png = Buffer.from(base64, "base64")
  const idat = png.indexOf("IDAT")
  const length = png.readUInt32BE(idat - 4)
  return inflateSync(png.subarray(idat + 4, idat + 4 + length))[1] / 40
}

function session() {
  const pi = new HostApi()
  const requests: Array<{ readonly method: string; readonly params: unknown }> = []
  const factory: ChildFactory = () => {
    const child = spawn(process.execPath, [FAKE_ENGINE, "--stdio"], { env: { ...process.env, FAKE_ENGINE_DESKTOP: "1", FAKE_ENGINE_CAPTURE_MARKERS: "1" }, stdio: "pipe" })
    children.push(child)
    createInterface({ input: child.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as { method?: unknown; params?: { message?: unknown } }
      const text = message.method === "engine.log" ? message.params?.message : undefined
      if (typeof text === "string" && text.startsWith(RECEIVED)) requests.push(JSON.parse(text.slice(RECEIVED.length)) as { method: string; params: unknown })
    })
    return child
  }
  const home = mkdtempSync(join(tmpdir(), "omo-screenshot-per-call-"))
  tempDirs.push(home)
  mkdirSync(join(home, ".omo"), { recursive: true })
  writeFileSync(join(home, ".omo", "omo.jsonc"), "{}")
  const settings = resolveComputerSettings({}, "linux")
  const context: ComponentContext = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } }
  createComputerUseComponent({ platform: "linux", env: { HOME: home }, engineChild: () => factory, loadSettings: () => settings }).register(pi, context)
  const hostContext = { cwd: "/work", model: undefined, hasUI: false, sessionManager: { getSessionId: () => "s", getSessionDir: () => join(home, "sessions") } }
  async function screenshot(callId: string): Promise<ReadonlyArray<Part>> {
    await pi.dispatch("tool_activated", { type: "tool_activated", toolNames: ["computer"] }, hostContext)
    const execute = pi.tools.find((tool) => tool.name === "computer")?.execute
    if (typeof execute !== "function") throw new Error("the computer tool is not registered")
    const result = (await execute(callId, { action: "call", chain: [{ method: "screenshot", args: [] }] }, undefined, undefined, hostContext)) as { content: Part[]; details: unknown; isError?: boolean }
    const settled = wire.decodeRemoteMessage(wire.encodeRemoteMessage({ kind: "settled", executionId: callId, result: { content: result.content, details: result.details ?? null, isError: result.isError === true } }))
    return settled.result?.content ?? []
  }
  return { pi, requests, settings, screenshot }
}

describe("one screenshot per computer call, across the hand wire (O1d, C4)", () => {
  test("#given a screen that changes between calls #when three computer calls each take a screenshot #then each result carries exactly one image, reading 1, 2, 3", async () => {
    // given
    const s = session()

    // when
    const results = [await s.screenshot("c1"), await s.screenshot("c2"), await s.screenshot("c3")]

    // then
    const images = results.map((content) => content.filter((part) => part.type === "image"))
    expect(images.map((list) => list.length)).toEqual([1, 1, 1])
    expect(images.map((list) => markerOf(list[0]?.data ?? ""))).toEqual([1, 2, 3])
  })

  test("#given an oversize screen #when a computer call captures it #then the request carries today's caps and the image is downscaled", async () => {
    // given
    const s = session()

    // when
    const content = await s.screenshot("c1")

    // then
    const capture = s.requests.find((request) => request.method === "capture")
    expect(capture?.params).toMatchObject({ caps: { maxWidth: s.settings.maxWidth, maxHeight: s.settings.maxHeight, maxBytes: s.settings.screenshotMaxBytes } })
    expect(content.find((part) => part.type === "text" && part.text?.includes("scaled from 5120x3200"))).toBeDefined()
  })

  test("#given three computer calls #when they run #then no live-view or screen-stream event is emitted", async () => {
    // given
    const s = session()

    // when
    for (const id of ["c1", "c2", "c3"]) await s.screenshot(id)

    // then
    expect(s.pi.rpcEvents.filter((event) => /live|stream|frame/i.test(JSON.stringify(event)))).toEqual([])
  })
})
