/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { BROWSER_BRIDGE_TOOL_NAME, BROWSER_STATE_EVENT, BROWSER_STOP_RPC, createBrowserBridgeComponent } from "./index"

type Handler = (data: unknown) => unknown | Promise<unknown>
type BridgeTool = {
  exposure: string
  permissionParser: (input: Record<string, unknown>, cwd: string) => unknown[]
  execute: (id: string, params: Record<string, unknown>) => Promise<{ details: Record<string, unknown> }>
}

function setup() {
  const pi = new FakeExtensionAPI()
  const handlers = new Map<string, Handler>()
  pi.rpc = {
    emit: (name, data) => {
      pi.rpcEvents.push({ name, data })
    },
    handle: (name: string, handler: Handler) => {
      handlers.set(name, handler)
    },
  } as typeof pi.rpc
  const ctx: ComponentContext = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } }
  createBrowserBridgeComponent().register(pi, ctx)
  const tool = pi.tools.find((entry) => entry.name === BROWSER_BRIDGE_TOOL_NAME) as unknown as BridgeTool
  return { pi, handlers, tool }
}

describe("browser bridge", () => {
  it("#given the skill reports a state #when the tool runs #then the app gets it as the session's omo.browser.state event", async () => {
    const { pi, tool } = setup()

    const result = await tool.execute("c1", { op: "state", data: { engine: "connected", status: "acting", action: "click" } })

    expect(result.details.ok).toBe(true)
    expect(pi.rpcEvents).toEqual([{ name: BROWSER_STATE_EVENT, data: { engine: "connected", status: "acting", action: "click" } }])
  })

  it("#given a malformed state #when the tool runs #then nothing is published", async () => {
    const { pi, tool } = setup()

    const result = await tool.execute("c1", { op: "state", data: { status: "acting" } })
    await tool.execute("c2", { op: "state" })

    expect(result.details.ok).toBe(false)
    expect(pi.rpcEvents).toEqual([])
  })

  it("#given the app presses Stop #when the skill asks #then it is told the user stopped, until the user writes again", async () => {
    const { pi, handlers, tool } = setup()
    expect((await tool.execute("c1", { op: "status" })).details.stopped).toBe(false)

    await handlers.get(BROWSER_STOP_RPC)?.({})
    expect((await tool.execute("c2", { op: "status" })).details.stopped).toBe(true)

    await pi.dispatch("input", { type: "input", source: "extension", text: "wake" })
    expect((await tool.execute("c3", { op: "status" })).details.stopped).toBe(true)

    await pi.dispatch("input", { type: "input", source: "interactive", text: "try again" })
    expect((await tool.execute("c4", { op: "status" })).details.stopped).toBe(false)
  })

  it("#given the daemon reports user_aborted #when the skill records it #then the stop holds for the turn", async () => {
    const { tool } = setup()

    await tool.execute("c1", { op: "stopped" })

    expect((await tool.execute("c2", { op: "status" })).details.stopped).toBe(true)
  })

  it("#given two sessions #when one is stopped #then the other is not", async () => {
    const first = setup()
    const second = setup()

    await first.handlers.get(BROWSER_STOP_RPC)?.({})

    expect((await first.tool.execute("c1", { op: "status" })).details.stopped).toBe(true)
    expect((await second.tool.execute("c2", { op: "status" })).details.stopped).toBe(false)
  })

  it("#given a host without rpc #when the skill reports a state #then it is a quiet no-op", async () => {
    const pi = new FakeExtensionAPI()
    const ctx: ComponentContext = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } }
    createBrowserBridgeComponent().register(pi, ctx)
    const tool = pi.tools.find((entry) => entry.name === BROWSER_BRIDGE_TOOL_NAME) as unknown as BridgeTool

    const result = await tool.execute("c1", { op: "state", data: { engine: "connected", status: "idle" } })

    expect(result.details.ok).toBe(true)
  })

  it("#given the tool #when registered #then the model never sees it and permission never asks for it", () => {
    const { tool } = setup()

    expect(tool.exposure).toBe("eval")
    expect(tool.permissionParser({ op: "state" }, "/work")).toEqual([])
  })
})
