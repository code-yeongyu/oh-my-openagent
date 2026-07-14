import { describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import { isPlainRecord } from "./record.js"
import { successResponse } from "./responses.js"
import { runJsonRpcStdioServer } from "./server.js"
import type { McpLifecycleLog } from "./types.js"

type CapturedLogEntry = {
  readonly event: string
  readonly fields?: Record<string, boolean | number | string | null>
}

describe("JSON-RPC stdio server", () => {
  test("#given request handler #when line request arrives #then response is written", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const received = nextOutput(output)
    const server = runJsonRpcStdioServer({
      input,
      output,
      handlerOptions: undefined,
      handler: async () => successResponse("ok", { acknowledged: true }),
    })

    input.end('{"jsonrpc":"2.0","id":"ok","method":"ping"}\n')

    expect(await received).toBe('{"jsonrpc":"2.0","id":"ok","result":{"acknowledged":true}}\n')
    await server
  })

  test("#given request handler and lifecycle logger #when line request arrives #then request lifecycle logs are emitted", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const logs = captureLogs()
    const received = nextOutput(output)
    const server = runJsonRpcStdioServer({
      input,
      output,
      log: logs.log,
      handlerOptions: undefined,
      handler: async () => successResponse("ok", { acknowledged: true }),
    })

    input.end('{"jsonrpc":"2.0","id":"ok","method":"ping"}\n')

    expect(await received).toBe('{"jsonrpc":"2.0","id":"ok","result":{"acknowledged":true}}\n')
    await server

    expect(logs.entries).toEqual([
      { event: "stdio_started", fields: { cwd: process.cwd(), idle_timeout_ms: 600000 } },
      { event: "request", fields: { id: "ok", method: "ping" } },
      { event: "response", fields: { id: "ok", method: "ping", is_error: false } },
      { event: "stdio_stopped" },
    ])
  })

  test("#given parse error override #when malformed line arrives #then override response is written", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const received = nextOutput(output)
    const server = runJsonRpcStdioServer({
      input,
      output,
      handlerOptions: undefined,
      handler: async () => undefined,
      parseErrorResponse: () => ({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Method not found" } }),
    })

    input.end("garbage\n")

    expect(await received).toBe('{"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"Method not found"}}\n')
    await server
  })

  test("#given lifecycle logger #when malformed line arrives #then parse error log is emitted and response is written", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const logs = captureLogs()
    const received = nextOutput(output)
    const server = runJsonRpcStdioServer({
      input,
      output,
      log: logs.log,
      handlerOptions: undefined,
      handler: async () => undefined,
    })

    input.end("garbage\n")

    const responseText = await received
    const response: unknown = JSON.parse(responseText)
    const error = isPlainRecord(response) ? response["error"] : undefined
    expect(responseText.endsWith("\n")).toBe(true)
    expect(isPlainRecord(response) ? response["jsonrpc"] : undefined).toBe("2.0")
    expect(isPlainRecord(response) ? response["id"] : undefined).toBeNull()
    expect(isPlainRecord(error) ? error["code"] : undefined).toBe(-32700)
    expect(isPlainRecord(error) ? error["message"] : undefined).toBe("Parse error")
    expect(typeof (isPlainRecord(error) ? error["data"] : undefined)).toBe("string")
    await server

    expect(logs.entries.map((entry) => entry.event)).toEqual(["stdio_started", "parse_error", "stdio_stopped"])
    expect(logs.entries.filter((entry) => entry.event === "parse_error").map((entry) => entry.fields?.["message"])).toEqual([
      expect.any(String),
    ])
  })
})

function captureLogs(): { readonly entries: readonly CapturedLogEntry[]; readonly log: McpLifecycleLog } {
  const entries: CapturedLogEntry[] = []
  const log: McpLifecycleLog = (event, fields) => {
    if (fields === undefined) {
      entries.push({ event })
      return
    }
    entries.push({ event, fields })
  }
  return { entries, log }
}

function nextOutput(output: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    output.once("data", (chunk: Buffer | string) => {
      resolve(String(chunk))
    })
  })
}
