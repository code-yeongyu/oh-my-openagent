/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"

import { HOST_TOOL_ROUTE_CHANNEL } from "./thread-tools"
import { cleanup, content, mcp, schema, session, setup } from "./thread-tools-test-support"

afterEach(cleanup)

const ATTACHED = {
  name: "render_page", inputSchema: schema,
  _meta: { "senpi/host-tool": { name: "host_page", label: "Host page" } },
}
const RESULT = { content, _meta: { "senpi/tool-result-details": { prepared: true } } }

function routeOf(routes: readonly unknown[]) {
  const route = routes.at(-1)
  if (typeof route !== "object" || route === null || !("execute" in route) || typeof route.execute !== "function") {
    throw new Error("no host route")
  }
  const execute = route.execute
  return (id = "A", signal?: AbortSignal) => Promise.resolve(Reflect.apply(execute, undefined, ["call", {}, signal, undefined, session(id)]))
}

describe("session-owned host tool routes", () => {
  it("#given two sessions with only A granted #when B shuts down #then A retains its live route and grant", async () => {
    const stub = await mcp({ tools: [ATTACHED], callResult: RESULT })
    let granted = true
    const host = await setup({
      offer: "host", hostToolNames: "host_page",
      reply: () => granted ? { grant: stub.grant } : { refusal: { reason: "denied" } },
    })
    await host.start("A")
    const route = routeOf(host.routes)
    granted = false
    await host.start("B")
    await host.shutdown("B")
    expect(host.routes).toHaveLength(1)
    expect(await route()).toEqual({ content, details: { prepared: true } })
    await host.turn("A")
    expect(host.pi.rpcEvents).toHaveLength(2)
    await host.shutdown("A")
    expect(host.routes.at(-1)).toEqual({ name: "host_page" })
  })

  for (const caller of ["A", "B"]) {
    it(`#given A owns the route #when ${caller === "A" ? "the host fails" : "ungranted B calls"} #then dropping the route also allows A to rediscover`, async () => {
      const options = { tools: [ATTACHED], callResult: RESULT, callFailure: caller === "A" }
      const stub = await mcp(options)
      const host = await setup({ offer: "host", hostToolNames: "host_page", reply: () => ({ grant: stub.grant }) })
      await host.start("A")
      const before = stub.requests.length
      await expect(routeOf(host.routes)(caller)).rejects.toMatchObject({ name: "HostToolRouteUnavailable" })
      if (caller === "B") expect(stub.requests).toHaveLength(before)
      expect(host.routes.at(-1)).toEqual({ name: "host_page" })
      options.callFailure = false
      const restored = Promise.withResolvers<void>()
      const off = host.pi.events?.on(HOST_TOOL_ROUTE_CHANNEL, (update) => {
        if (typeof update === "object" && update !== null && "execute" in update) restored.resolve()
      })
      try {
        await host.turn("A")
        await restored.promise
      } finally {
        off?.()
      }
      expect(host.pi.rpcEvents).toHaveLength(2)
      expect(await routeOf(host.routes)()).toEqual({ content, details: { prepared: true } })
    }, 5_000)
  }

  for (const ending of ["abort", "timeout", "already_aborted"] as const) {
    it(`#given a host route #when ${ending} occurs #then cancellation propagates without dropping its grant`, async () => {
      const options = { tools: [ATTACHED], callResult: RESULT, holdCall: true }
      const stub = await mcp(options)
      const host = await setup({
        timeoutMs: ending === "timeout" ? 100 : 1_000,
        offer: "host", hostToolNames: "host_page", reply: () => ({ grant: stub.grant }),
      })
      await host.start()
      const controller = new AbortController()
      if (ending === "already_aborted") controller.abort()
      const before = stub.requests.length
      const running = routeOf(host.routes)("A", controller.signal)
      const rejected = expect(running).rejects.toMatchObject({ name: "AbortError" })
      if (ending !== "already_aborted") {
        await stub.callStarted
        if (ending === "abort") controller.abort()
      }
      await rejected
      if (ending === "already_aborted") expect(stub.requests).toHaveLength(before)
      expect(host.routes).toHaveLength(1)
      options.holdCall = false
      await host.turn()
      expect(host.pi.rpcEvents).toHaveLength(1)
      expect(await routeOf(host.routes)()).toEqual({ content, details: { prepared: true } })
    }, 5_000)
  }

  it("#given B replaces A's route #when A shuts down #then B's route remains usable", async () => {
    const stub = await mcp({ tools: [ATTACHED], callResult: RESULT })
    const host = await setup({ offer: "host", hostToolNames: "host_page", reply: () => ({ grant: stub.grant }) })
    await host.start("A")
    await host.start("B")
    const count = host.routes.length
    await host.shutdown("A")
    expect(host.routes).toHaveLength(count)
    expect(await routeOf(host.routes)("B")).toEqual({ content, details: { prepared: true } })
    await host.shutdown("B")
  })
})
