import { describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import { readStdioJsonRpcMessages, writeStdioJsonRpcResponse } from "./transport.js"

describe("stdio JSON-RPC transport", () => {
  test("#given line-delimited JSON #when read #then it yields line-mode requests", async () => {
    const input = new PassThrough()
    input.end('{"jsonrpc":"2.0","id":1,"method":"ping"}\n')

    const messages = await collect(input)

    expect(messages).toEqual([
      {
        kind: "request",
        payload: { jsonrpc: "2.0", id: 1, method: "ping" },
        responseMode: "line",
      },
    ])
  })

  test("#given content-length JSON #when read #then it yields framed requests", async () => {
    const input = new PassThrough()
    const body = '{"jsonrpc":"2.0","id":2,"method":"initialize"}'
    input.end(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`)

    const messages = await collect(input)

    expect(messages).toEqual([
      {
        kind: "request",
        payload: { jsonrpc: "2.0", id: 2, method: "initialize" },
        responseMode: "framed",
      },
    ])
  })

  test("#given response mode #when written #then framing bytes are stable", () => {
    const output = new PassThrough()
    const chunks: string[] = []
    output.on("data", (chunk: Buffer | string) => chunks.push(String(chunk)))

    writeStdioJsonRpcResponse(output, { jsonrpc: "2.0", id: 1, result: {} }, "framed")

    expect(chunks.join("")).toBe('Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":1,"result":{}}')
  })
})

async function collect(input: PassThrough) {
  const messages = []
  for await (const message of readStdioJsonRpcMessages(input)) {
    messages.push(message)
  }
  return messages
}
