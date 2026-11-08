import { expect, test } from "bun:test"
import { SkillMcpManager, type SkillMcpClientOptions } from "./manager"

// #3364: a cancelled prompt must stop its in-flight MCP call, not only stop waiting for it.
type HangMode = "sse" | "pending"

function withinMs<T>(promise: Promise<T>, ms: number, waitingFor: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms}ms for ${waitingFor}, it never happened`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

// A modern MCP server whose tools/call never answers: "sse" opens the event stream and
// leaves it open, "pending" never sends response headers.
function startHangingServer(mode: HangMode) {
  let callReceived!: () => void
  let disconnected!: () => void
  const received = new Promise<void>((resolve) => { callReceived = resolve })
  const closed = new Promise<void>((resolve) => { disconnected = resolve })
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      if (request.method === "GET") return new Response(null, { status: 405 })
      const message = await request.json() as { id?: number | string; method: string }
      if (message.method === "server/discover") {
        return Response.json({ jsonrpc: "2.0", id: message.id, result: {
          resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} },
        } })
      }
      if (message.method !== "tools/call") return new Response(null, { status: 202 })
      callReceived()
      if (mode === "pending") {
        request.signal.addEventListener("abort", () => disconnected(), { once: true })
        return new Promise<Response>(() => {})
      }
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(": open\n\n")) },
        cancel() { disconnected() },
      }), { headers: { "content-type": "text/event-stream" } })
    },
  })
  return { server, received, closed }
}

async function startHangingCall(mode: HangMode, sessionID: string) {
  const { server, received, closed } = startHangingServer(mode)
  const manager = new SkillMcpManager()
  const controller = new AbortController()
  const options: SkillMcpClientOptions = { signal: controller.signal }
  const settled = manager.callTool(
    { serverName: "hanging", skillName: "test", sessionID },
    { skillName: "test", config: { url: server.url.href } },
    "never_answers",
    {},
    options,
  ).then(() => new Error("the hanging call resolved"), (error: unknown) => error)
  await withinMs(received, 5_000, "the server to receive tools/call")
  return {
    controller,
    settled,
    closed,
    async dispose() {
      await manager.disconnectAll()
      await server.stop(true)
    },
  }
}

test("aborting the caller signal rejects an in-flight skill MCP tool call with the signal's reason", async () => {
  const call = await startHangingCall("sse", "abort-reason")
  try {
    call.controller.abort()
    const error = await withinMs(call.settled, 2_000, "the tool call to reject after abort")
    expect(error).toBe(call.controller.signal.reason)
  } finally {
    await call.dispose()
  }
}, 15_000)

for (const mode of ["sse", "pending"] as const) {
  test(`aborting the caller signal closes the in-flight ${mode} HTTP request so the server sees the disconnect`, async () => {
    const call = await startHangingCall(mode, `abort-stream-${mode}`)
    try {
      call.controller.abort()
      await withinMs(call.closed, 5_000, `the server to see the ${mode} request disconnect`)
    } finally {
      await call.dispose()
    }
  }, 15_000)
}
