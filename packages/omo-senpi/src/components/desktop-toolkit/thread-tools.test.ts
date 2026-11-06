/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"

import { createDesktopToolkitComponent, TOOLKIT_GRANT_RPC, TOOLKIT_REQUEST_EVENT } from "./index"
import { cleanup, content, execute, mcp, schema, session, setup } from "./thread-tools-test-support"

afterEach(cleanup)

const ATTACHED = {
  name: "render_page",
  description: "Render a host page.",
  inputSchema: schema,
  _meta: { "senpi/host-tool": { name: "host_page", label: "Host page", exposure: "search", allowLazyActivation: true } },
}

function routeOf(routes: readonly unknown[]): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const last = routes.at(-1)
  if (typeof last !== "object" || last === null || !("execute" in last) || typeof last.execute !== "function") return undefined
  const execute = last.execute
  return (...args) => Promise.resolve(Reflect.apply(execute, undefined, args))
}

describe("desktop thread toolkit", () => {
  for (const { ending, mcpOptions, reply } of [
    { ending: "refused grant", mcpOptions: {}, reply: () => ({ refusal: { reason: "unavailable" } }) },
    { ending: "timed-out grant", mcpOptions: {}, reply: () => undefined },
    { ending: "failed discovery", mcpOptions: { listFailure: true }, reply: "grant" as const },
  ]) {
    it(`#11897: a ${ending} sets no host route and registers no second tool`, async () => {
      const stub = await mcp({ ...mcpOptions, tools: [ATTACHED] })
      const host = await setup({
        timeoutMs: 50, offer: "host", hostToolNames: "host_page",
        reply: reply === "grant" ? () => ({ grant: stub.grant }) : reply,
      })
      await host.start()
      expect(host.routes).toEqual([])
      expect(host.pi.tools.map((tool) => tool.name)).not.toContain("host_page")
    })
  }

  it("#11897: a confirmed grant routes the declared callable to the host and keeps details out of model content", async () => {
    const details = { html: "<p>host-only-page</p>", title: "Page", height: 300, prepared: true, path: "/work/.senpi/html-pages/page.html" }
    const stub = await mcp({ tools: [ATTACHED], callResult: { content, _meta: { "senpi/tool-result-details": details } } })
    const host = await setup({ offer: "host", hostToolNames: "host_page", reply: () => ({ grant: stub.grant }) })
    await host.start()
    expect(host.pi.tools.map((tool) => tool.name)).not.toContain("host_page")
    expect(host.routes).toHaveLength(1)
    expect(host.routes[0]).toMatchObject({ name: "host_page" })
    const route = routeOf(host.routes)
    if (route === undefined) throw new Error("no host route")
    const result = await route("call-1", { title: "Grouped" }, undefined, undefined, session("A"))
    expect(result).toEqual({ content, details })
    expect(JSON.stringify(content)).not.toContain("host-only-page")
    expect(stub.requests.filter((request) => request.method === "tools/call")).toEqual([
      { method: "tools/call", params: { name: "render_page", arguments: { title: "Grouped" } }, authorized: true },
    ])
    await host.shutdown()
    expect(host.routes.at(-1)).toEqual({ name: "host_page" })
  })

  it("#11897: a lost grant makes the route report unavailable so senpi runs the standalone tool", async () => {
    const stub = await mcp({ tools: [ATTACHED], callFailure: true })
    const host = await setup({ offer: "host", hostToolNames: "host_page", reply: () => ({ grant: stub.grant }) })
    await host.start()
    const route = routeOf(host.routes)
    if (route === undefined) throw new Error("no host route")
    await expect(route("call-1", { title: "Grouped" }, undefined, undefined, session("A"))).rejects.toMatchObject({ name: "HostToolRouteUnavailable" })
    await expect(route("call-2", { title: "Grouped" }, undefined, undefined, session("B"))).rejects.toMatchObject({ name: "HostToolRouteUnavailable" })
    expect(JSON.stringify(host.logs)).not.toContain(stub.token())
  })

  it("#given no thread offer #when session starts #then no request or desktop tool", async () => {
    const host = await setup({ offer: "browser" })
    await host.start()
    expect(host.tools()).toEqual([])
    expect(host.pi.rpcEvents).toEqual([])
  })

  for (const sse of [false, true]) {
    it(`#given a grant and ${sse ? "SSE" : "JSON"} MCP #when starting and calling #then schema bearer arguments and content are forwarded`, async () => {
      const stub = await mcp({ sse })
      const host = await setup({ reply: () => ({ grant: stub.grant }) })
      await host.start()
      await host.start()
      expect(host.pi.rpcEvents).toHaveLength(1)
      expect(host.pi.rpcEvents[0]).toMatchObject({ name: TOOLKIT_REQUEST_EVENT, data: { toolkit: "thread" } })
      expect(host.tools()).toHaveLength(1)
      const tool = host.tools()[0]
      expect(tool).toMatchObject({ name: "desktop_thread_organize", parameters: schema, description: "Organize this desktop thread." })
      expect(host.pi.tools.some((entry) => entry.name === "thread_organize")).toBe(false)
      await stub.rotate()
      const result = await execute(tool)
      expect(result.content).toEqual(content)
      expect(stub.requests.filter((request) => request.method === "tools/call")).toEqual([
        { method: "tools/call", params: { name: "thread_organize", arguments: { title: "Grouped" } }, authorized: true },
      ])
      expect(JSON.stringify([host.logs, result])).not.toContain(stub.token())
    })
  }

  it("#given refusal #when starting #then no tools and a nonsecret diagnostic", async () => {
    const secret = "refusal-must-not-be-logged"
    const host = await setup({ reply: () => ({ refusal: { reason: secret } }) })
    await host.start()
    expect(host.pi.rpcEvents).toHaveLength(1)
    expect(host.tools()).toEqual([])
    expect(host.logs.length).toBeGreaterThan(0)
    expect(JSON.stringify(host.logs)).not.toContain(secret)
  })

  it("#given no grant reply #when the acquisition deadline expires #then no tools and late grant rejected", async () => {
    const host = await setup({ timeoutMs: 10 })
    await host.start()
    expect(host.pi.rpcEvents).toHaveLength(1)
    const data = host.pi.rpcEvents[0]?.data
    if (typeof data !== "object" || data === null || !("requestId" in data)) throw new Error("request missing")
    expect(host.handlers.get(TOOLKIT_GRANT_RPC)?.({ requestId: data.requestId, grant: { endpoint: "http://127.0.0.1:1/mcp", tokenFile: "/unused" } })).toEqual({ accepted: false })
    expect(host.tools()).toEqual([])
    expect(host.logs.length).toBeGreaterThan(0)
  })

  it("#given tools/list failure containing a bearer #when starting #then no registrations or credential disclosure", async () => {
    const stub = await mcp({ listFailure: true })
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.start()
    expect(stub.requests.some((request) => request.method === "tools/list")).toBe(true)
    expect(host.tools()).toEqual([])
    expect(host.logs.length).toBeGreaterThan(0)
    expect(JSON.stringify(host.logs)).not.toContain(stub.token())
  })

  it("#given two registrations from one module #when A's executor is called in B #then B cannot spend A's grant", async () => {
    const stub = await mcp()
    const component = createDesktopToolkitComponent()
    const a = await setup({ component, reply: () => ({ grant: stub.grant }) })
    const b = await setup({ component, offer: "browser" })
    await a.start("A")
    await b.start("B")
    expect(b.tools()).toEqual([])
    expect(b.pi.rpcEvents).toEqual([])
    const before = stub.requests.length
    const result = await execute(a.tools()[0], "B")
    expect(result.isError).toBe(true)
    expect(stub.requests).toHaveLength(before)
    expect(JSON.stringify([result, a.logs, b.logs])).not.toContain(stub.token())
    expect((await execute(a.tools()[0], "A")).content).toEqual(content)
  })

  it("#given no calling session identity #when an executor is called #then it refuses without an HTTP request", async () => {
    const stub = await mcp()
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.start()
    const tool = host.tools()[0]
    if (typeof tool?.execute !== "function") throw new Error("desktop tool was not registered")
    const before = stub.requests.length
    const result = await tool.execute("call-1", {})
    expect(result.isError).toBe(true)
    expect(stub.requests).toHaveLength(before)
  })

  for (const failure of ["callFailure", "echoToken"] as const) {
    it(`#given a credential in ${failure} #when executing #then results errors and logs do not disclose it`, async () => {
      const stub = await mcp({ [failure]: true })
      const host = await setup({ reply: () => ({ grant: stub.grant }) })
      await host.start()
      const result = await execute(host.tools()[0])
      expect(result.isError).toBe(true)
      expect(JSON.stringify([result, host.logs])).not.toContain(stub.token())
    })
  }

  for (const missing of ["withRpc", "withRegisterTool"] as const) {
    it(`#given no ${missing} #when starting #then the bridge is a no-op`, async () => {
      const host = await setup({ [missing]: false })
      await host.start()
      expect(host.tools()).toEqual([])
      expect(host.pi.rpcEvents).toEqual([])
    })
  }

  it("#given paginated tools #when discovering #then it follows the cursor and terminates its MCP session", async () => {
    const stub = await mcp({ paginated: true })
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.start()
    expect(host.tools()).toHaveLength(1)
    expect(stub.requests.filter((request) => request.method === "tools/list").at(-1)?.params).toEqual({ cursor: "second" })
    expect(stub.requests.filter((request) => request.method === "tools/list")).toHaveLength(2)
    expect(stub.closedSessions()).toBe(1)
  })

  it("#given an unrelated response id #when initializing #then no tool is registered", async () => {
    const stub = await mcp({ wrongId: true })
    const host = await setup({ timeoutMs: 20, reply: () => ({ grant: stub.grant }) })
    await host.start()
    expect(host.tools()).toEqual([])
    expect(host.logs.length).toBeGreaterThan(0)
  })

  it("#given a redirect #when initializing #then it is not followed with the bearer", async () => {
    const stub = await mcp({ redirect: true })
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.start()
    expect(host.tools()).toEqual([])
    expect(stub.requests).toHaveLength(1)
    expect(JSON.stringify(host.logs)).not.toContain(stub.token())
  })

  it("#given an open SSE call #when the caller aborts #then execution settles without leaking credentials", async () => {
    const stub = await mcp({ holdCall: true })
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.start()
    const controller = new AbortController()
    const running = execute(host.tools()[0], "A", controller.signal)
    await stub.callStarted
    controller.abort()
    const result = await running
    expect(result.isError).toBe(true)
    expect(JSON.stringify([result, host.logs])).not.toContain(stub.token())
  }, 5_000)

  it("#given an open SSE call #when its deadline expires #then execution settles without leaking credentials", async () => {
    const stub = await mcp({ holdCall: true })
    const host = await setup({ timeoutMs: 1_000, reply: () => ({ grant: stub.grant }) })
    await host.start()
    const running = execute(host.tools()[0])
    await stub.callStarted
    const result = await running
    expect(result.isError).toBe(true)
    expect(JSON.stringify([result, host.logs])).not.toContain(stub.token())
  }, 5_000)
})
