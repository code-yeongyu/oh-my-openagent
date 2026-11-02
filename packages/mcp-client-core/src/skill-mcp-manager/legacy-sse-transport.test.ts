import { expect, jest, test } from "bun:test"
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from "@modelcontextprotocol/sdk/shared/protocol.js"
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js"
import { SkillMcpManager } from "./manager"

type JsonRpcMessage = { id?: number | string; method: string; params?: { protocolVersion?: string } }

const LEGACY_PROTOCOL_VERSION = "2024-11-05"

// A legacy HTTP+SSE server (protocol 2024-11-05): GET /sse opens the event stream and
// advertises the POST endpoint; responses travel over the stream. Like the servers in #9050,
// it answers a Streamable HTTP POST to the stream URL with 405.
function startLegacySseServer(options: { advertiseEndpoint: boolean }) {
  const encoder = new TextEncoder()
  const received: { method: string; path: string; header: string | null; protocolVersion: string | null }[] = []
  const streamOpened = Promise.withResolvers<void>()
  const streamClosed = Promise.withResolvers<void>()
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const record = (request: Request, method: string, path: string) => received.push({
    method, path, header: request.headers.get("X-Skill-Header"), protocolVersion: request.headers.get("mcp-protocol-version"),
  })
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/sse" && request.method === "GET") {
        record(request, "GET", url.pathname)
        request.signal.addEventListener("abort", () => streamClosed.resolve(), { once: true })
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller
            if (options.advertiseEndpoint) {
              controller.enqueue(encoder.encode("event: endpoint\ndata: /messages?sessionId=legacy\n\n"))
            }
            streamOpened.resolve()
          },
        }), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } })
      }
      if (url.pathname !== "/messages" || request.method !== "POST") {
        record(request, request.method, url.pathname)
        return new Response("Method Not Allowed", { status: 405 })
      }
      const message = await request.json() as JsonRpcMessage
      record(request, message.method, url.pathname)
      if (message.id !== undefined) {
        const result = message.method === "initialize"
          ? { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "legacy-sse", version: "1" } }
          : message.method === "tools/list"
            ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
            : undefined
        const reply = result
          ? { jsonrpc: "2.0", id: message.id, result }
          : { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }
        stream?.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(reply)}\n\n`))
      }
      return new Response("Accepted", { status: 202 })
    },
  })
  return { server, received, streamOpened: streamOpened.promise, streamClosed: streamClosed.promise }
}

function sseConfig(server: { url: URL }) {
  return { type: "sse" as const, url: new URL("/sse", server.url).href, headers: { "X-Skill-Header": "present" } }
}

async function settlesWithin<T>(promise: Promise<T>, what: string, ms = 5_000): Promise<T> {
  const breaker = Promise.withResolvers<never>()
  const timer = setTimeout(() => breaker.reject(new Error(`waited ${ms}ms for ${what}, it never happened`)), ms)
  try {
    return await Promise.race([promise, breaker.promise])
  } finally {
    clearTimeout(timer)
  }
}

test("#given a type sse skill MCP on a legacy HTTP+SSE server #when listing tools #then it connects over the GET event stream and the advertised POST endpoint", async () => {
  // given
  const { server, received } = startLegacySseServer({ advertiseEndpoint: true })
  const manager = new SkillMcpManager()

  try {
    // when
    const tools = await manager.listTools(
      { serverName: "legacy-sse", skillName: "test", sessionID: "sse" },
      { skillName: "test", config: sseConfig(server) },
    )

    // then
    expect(tools.map((tool) => tool.name)).toEqual(["echo"])
    expect(received.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /sse",
      "initialize /messages",
      "notifications/initialized /messages",
      "tools/list /messages",
    ])
    expect(received.every(({ header }) => header === "present")).toBe(true)
    expect(received.at(-1)?.protocolVersion).toBe(LEGACY_PROTOCOL_VERSION)
  } finally {
    await manager.disconnectAll()
    await server.stop(true)
  }
})

test("#given a type sse server that never advertises its endpoint #when connecting #then the connect fails at the SDK request budget with a request timeout and closes the stream", async () => {
  // given
  const { server, streamOpened, streamClosed } = startLegacySseServer({ advertiseEndpoint: false })
  const manager = new SkillMcpManager()
  jest.useFakeTimers()

  try {
    // when
    const outcome = manager.listTools(
      { serverName: "silent-sse", skillName: "test", sessionID: "sse-timeout" },
      { skillName: "test", config: sseConfig(server) },
    ).then(() => undefined, (error: unknown) => error)
    await settlesWithin(streamOpened, "the GET event stream to open")
    jest.advanceTimersByTime(DEFAULT_REQUEST_TIMEOUT_MSEC)
    jest.useRealTimers()

    // then
    const error = await settlesWithin(outcome, "the connect to fail at the request budget")
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain(`MCP error ${ErrorCode.RequestTimeout}: Request timed out`)
    await settlesWithin(streamClosed, "the client to close the GET event stream")
  } finally {
    jest.useRealTimers()
    await manager.disconnectAll()
    await server.stop(true)
  }
})
