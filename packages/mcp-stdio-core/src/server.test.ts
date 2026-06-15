import { describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import { successResponse } from "./responses.js"
import { runJsonRpcStdioServer } from "./server.js"

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
})

function nextOutput(output: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    output.once("data", (chunk: Buffer | string) => {
      resolve(String(chunk))
    })
  })
}
