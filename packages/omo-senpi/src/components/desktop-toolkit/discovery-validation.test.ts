/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"

import { cleanup, content, execute, mcp, schema, setup } from "./thread-tools-test-support"

afterEach(cleanup)

describe("desktop thread tool discovery validation", () => {
  it("#given malformed host metadata mixed with valid tools #when discovering #then invalid entries are skipped individually", async () => {
    const invalid = [
      null, [], "private_metadata", {},
      { name: "bad.name", label: "private_label" },
      { name: "host_page", label: 42 },
      { name: "host_page", label: "Page", exposure: "invalid" },
      { name: "host_page", label: "Page", allowLazyActivation: "yes" },
      { name: "host_page", label: "Page", searchKeywords: [42] },
    ]
    const stub = await mcp({ tools: [
      ...invalid.map((meta) => ({ name: "render_page", inputSchema: schema, _meta: { "senpi/host-tool": meta } })),
      { name: "thread_organize", inputSchema: schema },
      { name: "render_page", inputSchema: schema, _meta: { "senpi/host-tool": { name: "host_page", label: "Page" } } },
    ] })
    const host = await setup({ offer: "thread,host", hostToolNames: "host_page", reply: () => ({ grant: stub.grant }) })
    await host.start()
    expect(host.tools().map((tool) => tool.name)).toEqual(["desktop_thread_organize"])
    expect(host.routes).toHaveLength(1)
    expect(host.logs).toHaveLength(invalid.length * 2)
    expect(host.logs.every((entry) => typeof entry === "object" && entry !== null && "details" in entry &&
      JSON.stringify(entry.details) === JSON.stringify({ reason: "invalid_descriptor" }))).toBe(true)
    expect(JSON.stringify(host.logs)).not.toContain("private")
    expect((await execute(host.tools()[0])).content).toEqual(content)
  })

  it("#given invalid names mixed with valid names #when discovering #then only provider-safe names register", async () => {
    const valid = ["thread_organize", "a".repeat(56), "Mixed-123_Name"]
    const invalid = ["", "a.b", "a b", "a".repeat(57), "private\nname"]
    const stub = await mcp({ tools: [...invalid, ...valid].map((name) => ({ name, inputSchema: schema })) })
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.start()
    expect(host.tools().map((tool) => tool.name)).toEqual(valid.map((name) => `desktop_${name}`))
    expect(host.logs).toHaveLength(invalid.length)
    expect(JSON.stringify(host.logs)).not.toContain("private")
    expect(JSON.stringify(host.logs)).not.toContain(stub.token())
  })

  it("#given invalid schemas and descriptors #when discovering #then valid tools survive and diagnostics are nonsecret", async () => {
    const badSchemas = [null, true, [], "object", {}, { type: "array" }, { type: ["object", "null"] }]
    const tools = [
      ...badSchemas.map((inputSchema) => ({ name: "private_schema", inputSchema })),
      null, [], { name: 12, inputSchema: schema }, { name: "private_description", description: 42, inputSchema: schema },
      { name: "thread_organize", inputSchema: schema },
    ]
    const stub = await mcp({ tools })
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.start()
    expect(host.tools().map((tool) => tool.name)).toEqual(["desktop_thread_organize"])
    expect(host.logs).toHaveLength(tools.length - 1)
    expect(JSON.stringify(host.logs)).not.toContain("private")
    expect((await execute(host.tools()[0])).content).toEqual(content)
  })

  it("#given a host tool with the discovered name #when discovering #then it is not overwritten", async () => {
    const stub = await mcp()
    const host = await setup({
      existingTools: [{ name: "desktop_thread_organize" }],
      reply: () => ({ grant: stub.grant }),
    })
    await host.start()
    expect(host.tools()).toHaveLength(0)
  })

  it("#given duplicate tools in one discovery #when registering #then the first registration wins", async () => {
    const stub = await mcp({ tools: [
      { name: "thread_organize", description: "first", inputSchema: schema },
      { name: "thread_organize", description: "second", inputSchema: schema },
    ] })
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.start()
    expect(host.tools()).toHaveLength(1)
    expect(host.tools()[0]?.description).toBe("first")
  })

  for (const ending of ["abort", "timeout"] as const) {
    it(`#given an open MCP call #when ${ending} occurs #then DELETE uses a fresh signal`, async () => {
      const stub = await mcp({ holdCall: true })
      const host = await setup({ timeoutMs: ending === "timeout" ? 100 : 1_000, reply: () => ({ grant: stub.grant }) })
      await host.start()
      expect(stub.closedSessions()).toBe(1)
      const controller = new AbortController()
      const running = execute(host.tools()[0], "A", controller.signal)
      await stub.callStarted
      if (ending === "abort") controller.abort()
      expect((await running).isError).toBe(true)
      expect(stub.closedSessions()).toBe(2)
    })
  }

  it("#given DELETE redirects #when discovery and a call succeed #then cleanup failure does not replace their results", async () => {
    const stub = await mcp({ deleteFailure: true })
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.start()
    expect(host.tools()).toHaveLength(1)
    expect((await execute(host.tools()[0])).content).toEqual(content)
    expect(stub.closedSessions()).toBe(2)
  })
})
