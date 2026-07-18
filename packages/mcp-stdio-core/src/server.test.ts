import { describe, expect, test } from "bun:test"
import { PassThrough, Readable, Writable } from "node:stream"
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

  test("#given parent output closes during a response #when the stdio server writes #then the child settles without an uncaught stream error", async () => {
    const serverUrl = new URL("./server.ts", import.meta.url).href
    const script = `
      import { Readable, Writable } from "node:stream";
      import { successResponse } from ${JSON.stringify(new URL("./responses.ts", import.meta.url).href)};
      import { runJsonRpcStdioServer } from ${JSON.stringify(serverUrl)};

      const output = new Writable({
        write(_chunk, _encoding, callback) {
          callback(Object.assign(new Error("parent output closed"), { code: "EPIPE" }));
        },
      });
      await runJsonRpcStdioServer({
        input: Readable.from(['{"jsonrpc":"2.0","id":"closed","method":"ping"}\\n']),
        output,
        handlerOptions: undefined,
        handler: async () => successResponse("closed", { acknowledged: true }),
      });
      process.stderr.write("server-settled\\n");
    `
    const child = Bun.spawn([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "server-settled\n" })
  })

  test("#given a non-serializable response #when the stdio server writes #then the serialization failure rejects", async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic["self"] = cyclic

    const server = runJsonRpcStdioServer({
      input: Readable.from(['{"jsonrpc":"2.0","id":"cyclic","method":"ping"}\n']),
      output: new PassThrough(),
      handlerOptions: undefined,
      handler: async () => successResponse("cyclic", cyclic),
    })

    await expect(server).rejects.toBeInstanceOf(TypeError)
  })

  test("#given an unknown output failure #when the stdio server writes #then the failure rejects", async () => {
    const outputError = Object.assign(new Error("synthetic output failure"), { code: "EIO" })
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(outputError)
      },
    })

    const server = runJsonRpcStdioServer({
      input: Readable.from(['{"jsonrpc":"2.0","id":"unknown","method":"ping"}\n']),
      output,
      handlerOptions: undefined,
      handler: async () => successResponse("unknown", { acknowledged: true }),
    })

    await expect(server).rejects.toBe(outputError)
  })
})

function nextOutput(output: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    output.once("data", (chunk: Buffer | string) => {
      resolve(String(chunk))
    })
  })
}
