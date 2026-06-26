import { describe, expect, test } from "bun:test"
import { PassThrough, Readable } from "node:stream"

import { runCodegraphMcpProxy } from "./proxy.js"
import type { CodegraphProjectSynchronizer, CodegraphServerHandle } from "./types.js"

describe("CodeGraph MCP proxy", () => {
  test("#given a secondary projectPath tool call #when proxied #then refresh finishes before forwarding", async () => {
    const events: string[] = []
    const forwarded: string[] = []
    const server = fakeServer(forwarded)
    const synchronizer: CodegraphProjectSynchronizer = {
      initialize: async () => {
        events.push("initial-ready")
      },
      refresh: async (projectPath, autoInit) => {
        events.push(`refreshed:${projectPath}`)
        expect(autoInit).toBe(true)
        return true
      },
    }
    server.input.on("data", () => events.push("forwarded"))

    const exitCode = await runCodegraphMcpProxy({
      autoInit: true,
      command: { argsPrefix: [], command: "/bin/codegraph" },
      cwd: "/repo/a",
      env: {},
      input: Readable.from([
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "codegraph_search", arguments: { projectPath: "/repo/b", query: "fresh" } } })}\n`,
      ]),
      output: new PassThrough(),
      stderr: new PassThrough(),
      spawnServer: () => server,
      synchronizer,
    })

    expect(exitCode).toBe(0)
    expect(events).toEqual(["initial-ready", "refreshed:/repo/b", "forwarded"])
    expect(forwarded.join("")).toContain('"projectPath":"/repo/b"')
  })

  test("#given secondary refresh fails #when proxied #then stale call is rejected and never forwarded", async () => {
    const forwarded: string[] = []
    const output: string[] = []
    const server = fakeServer(forwarded)
    const capture = new PassThrough()
    capture.on("data", (chunk: Buffer | string) => output.push(String(chunk)))

    await runCodegraphMcpProxy({
      autoInit: true,
      command: { argsPrefix: [], command: "/bin/codegraph" },
      cwd: "/repo/a",
      env: {},
      input: Readable.from([
        `${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "codegraph_search", arguments: { projectPath: "/repo/b", query: "fresh" } } })}\n`,
      ]),
      output: capture,
      stderr: new PassThrough(),
      spawnServer: () => server,
      synchronizer: {
        initialize: () => Promise.resolve(),
        refresh: () => Promise.reject(new Error("sync lock timed out")),
      },
    })

    expect(forwarded).toEqual([])
    expect(output.join("")).toContain('"code":-32001')
    expect(output.join("")).toContain("sync lock timed out")
  })
})

function fakeServer(forwarded: string[]): CodegraphServerHandle {
  const input = new PassThrough()
  input.on("data", (chunk: Buffer | string) => forwarded.push(String(chunk)))
  return {
    input,
    output: new PassThrough(),
    error: new PassThrough(),
    wait: () => new Promise((resolve) => input.once("finish", () => resolve(0))),
    terminate: () => input.destroy(),
  }
}
