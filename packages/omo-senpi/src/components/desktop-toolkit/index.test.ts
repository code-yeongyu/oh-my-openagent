/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import {
  DESKTOP_TOOLKIT_TOOL_NAME,
  TOOLKIT_GRANT_RPC,
  TOOLKIT_REQUEST_EVENT,
  createDesktopToolkitComponent,
} from "./index"

type Handler = (data: unknown) => unknown | Promise<unknown>
type ToolkitTool = {
  exposure: string
  execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>
}

const GRANT = { endpoint: "http://127.0.0.1:41234/toolkit/browser", tokenFile: "/tmp/omo-toolkit/browser.token" }

function setup(options: { readonly sessionContext?: unknown; readonly timeoutMs?: number; readonly withRpc?: boolean } = {}) {
  const pi = new FakeExtensionAPI() as FakeExtensionAPI & { sessionContext?: unknown }
  const handlers = new Map<string, Handler>()
  if (options.withRpc !== false) {
    pi.rpc = {
      emit: (name, data) => {
        pi.rpcEvents.push({ name, data })
      },
      handle: (name: string, handler: Handler) => {
        handlers.set(name, handler)
      },
    } as typeof pi.rpc
  }
  pi.sessionContext = "sessionContext" in options ? options.sessionContext : { omo_toolkits: "browser" }
  const ctx: ComponentContext = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } }
  createDesktopToolkitComponent({ timeoutMs: options.timeoutMs ?? 1_000 }).register(pi, ctx)
  const tool = pi.tools.find((entry) => entry.name === DESKTOP_TOOLKIT_TOOL_NAME) as unknown as ToolkitTool
  const nextRequest = async () => {
    while (pi.rpcEvents.length === 0) await Promise.resolve()
    return pi.rpcEvents.at(-1) as { name: string; data: { requestId: string; toolkit: string } }
  }
  return { pi, handlers, tool, nextRequest }
}

describe("desktop toolkit", () => {
  it("#given the app offers the browser #when the skill acquires it #then it gets the app's grant for that request", async () => {
    const { handlers, tool, nextRequest } = setup()

    const pendingResult = tool.execute("c1", { op: "acquire", toolkit: "browser" })
    const request = await nextRequest()
    expect(request.name).toBe(TOOLKIT_REQUEST_EVENT)
    expect(request.data.toolkit).toBe("browser")
    expect(await handlers.get(TOOLKIT_GRANT_RPC)?.({ requestId: request.data.requestId, grant: GRANT })).toEqual({ accepted: true })

    expect((await pendingResult).details).toEqual({ ok: true, grant: GRANT })
    expect(tool.exposure).toBe("eval")
  })

  it("#given an app that offers no toolkits #when the skill acquires one #then it is told at once and nothing is asked", async () => {
    for (const sessionContext of [undefined, {}, { omo_toolkits: "" }, { omo_toolkits: "pull-requests" }]) {
      const { pi, tool } = setup({ sessionContext })

      const result = await tool.execute("c1", { op: "acquire", toolkit: "browser" })

      expect(result.details).toEqual({ ok: false, reason: "unavailable" })
      expect(pi.rpcEvents).toEqual([])
    }
    const noHost = setup({ withRpc: false })
    expect((await noHost.tool.execute("c1", { op: "acquire", toolkit: "browser" })).details).toEqual({ ok: false, reason: "unavailable" })
  })

  it("#given the app never answers #when the deadline passes #then the skill gets a timeout and a late grant is refused", async () => {
    const { handlers, tool, nextRequest } = setup({ timeoutMs: 20 })

    const pendingResult = tool.execute("c1", { op: "acquire", toolkit: "browser" })
    const request = await nextRequest()
    expect((await pendingResult).details).toEqual({ ok: false, reason: "timeout" })

    expect(await handlers.get(TOOLKIT_GRANT_RPC)?.({ requestId: request.data.requestId, grant: GRANT })).toEqual({ accepted: false })
  })

  it("#given the app refuses #when the skill acquires #then it gets the app's reason", async () => {
    const { handlers, tool, nextRequest } = setup()

    const pendingResult = tool.execute("c1", { op: "acquire", toolkit: "browser" })
    const request = await nextRequest()
    await handlers.get(TOOLKIT_GRANT_RPC)?.({ requestId: request.data.requestId, refusal: { reason: "app_window_closed" } })

    expect((await pendingResult).details).toEqual({ ok: false, reason: "app_window_closed" })
  })

  it("#given a grant that is not a loopback endpoint with a token file #when it arrives #then the skill gets invalid_grant", async () => {
    const bad = [
      { endpoint: "http://example.com/toolkit", tokenFile: "/tmp/t" },
      { endpoint: "http://127.0.0.1:1/toolkit?token=abc", tokenFile: "/tmp/t" },
      { endpoint: "http://user:pass@127.0.0.1:1/toolkit", tokenFile: "/tmp/t" },
      { endpoint: "ws://127.0.0.1:1/toolkit", tokenFile: "/tmp/t" },
      { endpoint: "http://127.0.0.1:1/toolkit", tokenFile: "relative/t" },
      { endpoint: "http://127.0.0.1:1/toolkit", token: "secret" },
    ]
    for (const grant of bad) {
      const { handlers, tool, nextRequest } = setup()
      const pendingResult = tool.execute("c1", { op: "acquire", toolkit: "browser" })
      const request = await nextRequest()
      await handlers.get(TOOLKIT_GRANT_RPC)?.({ requestId: request.data.requestId, grant })
      const result = await pendingResult
      expect(result.details).toEqual({ ok: false, reason: "invalid_grant" })
      expect(result.content[0]?.text).not.toContain("secret")
    }
  })

  it("#given two sessions #when one is granted #then the other's request is unaffected", async () => {
    const first = setup()
    const second = setup({ timeoutMs: 20 })

    const firstResult = first.tool.execute("c1", { op: "acquire", toolkit: "browser" })
    const secondResult = second.tool.execute("c1", { op: "acquire", toolkit: "browser" })
    const firstRequest = await first.nextRequest()
    await second.nextRequest()
    await first.handlers.get(TOOLKIT_GRANT_RPC)?.({ requestId: firstRequest.data.requestId, grant: GRANT })
    expect(await second.handlers.get(TOOLKIT_GRANT_RPC)?.({ requestId: firstRequest.data.requestId, grant: GRANT })).toEqual({ accepted: false })

    expect((await firstResult).details).toEqual({ ok: true, grant: GRANT })
    expect((await secondResult).details).toEqual({ ok: false, reason: "timeout" })
  })
})
