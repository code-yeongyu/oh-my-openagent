/// <reference types="bun-types" />

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { enableFakeExtensionEvents, FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { createDesktopToolkitComponent, TOOLKIT_GRANT_RPC } from "./index"
import { HOST_TOOL_ROUTE_CHANNEL } from "./thread-tools"

export const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] }
export const content = [{ type: "text", text: "organized" }]
const cleanups: (() => Promise<void>)[] = []
export async function cleanup() {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
}

export function session(id: string) {
  return { sessionManager: { getSessionId: () => id } }
}

export async function setup(options: {
  offer?: string
  hostToolNames?: string
  reply?: (request: Record<string, unknown>) => Record<string, unknown> | undefined
  timeoutMs?: number
  withRpc?: boolean
  withRegisterTool?: boolean
  deferred?: boolean
  existingTools?: readonly { name: string }[]
  component?: ReturnType<typeof createDesktopToolkitComponent>
} = {}) {
  const pi = new FakeExtensionAPI()
  enableFakeExtensionEvents(pi)
  const routes: unknown[] = []
  pi.events?.on(HOST_TOOL_ROUTE_CHANNEL, (route) => { routes.push(route) })
  const registered = Promise.withResolvers<void>()
  const registerTool = pi.registerTool.bind(pi)
  pi.registerTool = (tool) => {
    registerTool(tool)
    if (String(tool.name).startsWith("desktop_")) registered.resolve()
  }
  if (options.existingTools) Object.defineProperty(pi, "getAllTools", { value: () => options.existingTools })
  Object.defineProperty(pi, "sessionContext", { value: {
    omo_toolkits: options.offer ?? "thread",
    ...(options.hostToolNames === undefined ? {} : { host_tool_names: options.hostToolNames }),
  } })
  const handlers = new Map<string, (data: unknown) => unknown>()
  const deferred: (() => void | Promise<void>)[] = []
  const requested = Promise.withResolvers<Record<string, unknown>>()
  const logs: unknown[] = []
  const failureWaiters: { readonly count: number; readonly resolve: () => void }[] = []
  let failureCount = 0
  const log = (message: string, details?: unknown) => {
    logs.push({ message, details })
    if (message !== "desktop thread toolkit unavailable") return
    failureCount += 1
    for (const waiter of failureWaiters.filter((entry) => entry.count <= failureCount)) {
      failureWaiters.splice(failureWaiters.indexOf(waiter), 1)
      waiter.resolve()
    }
  }
  // Resolves once `count` failed discoveries have been logged; register it before the turn that triggers one.
  const failures = (count: number) => {
    if (failureCount >= count) return Promise.resolve()
    const waiter = Promise.withResolvers<void>()
    failureWaiters.push({ count, resolve: waiter.resolve })
    return waiter.promise
  }
  const ctx: ComponentContext = { logger: { debug: log, info: log, warn: log, error: log }, config: { getFlag: () => undefined } }
  if (options.deferred !== false) ctx.deferStartupWork = (_label, work) => { deferred.push(work) }
  const rpc: NonNullable<SenpiExtensionAPI["rpc"]> = {
    emit(name, data) {
      pi.rpcEvents.push({ name, data })
      if (typeof data !== "object" || data === null || !("requestId" in data)) return
      requested.resolve(data)
      const response = options.reply?.(data)
      if (response !== undefined) handlers.get(TOOLKIT_GRANT_RPC)?.({ requestId: data.requestId, ...response })
    },
    handle(name, handler) { handlers.set(name, handler) },
  }
  if (options.withRpc !== false) pi.rpc = rpc
  if (options.withRegisterTool === false) Object.defineProperty(pi, "registerTool", { value: undefined })
  const component = options.component ?? createDesktopToolkitComponent({ timeoutMs: options.timeoutMs ?? 1_000 })
  await component.register(pi, ctx)
  const dispatchStart = (id = "A") => pi.dispatch("session_start", { type: "session_start" }, session(id))
  const flushStartup = async () => { for (const work of deferred.splice(0)) await work() }
  const shutdown = (id = "A") => pi.dispatch("session_shutdown", { type: "session_shutdown" }, session(id))
  cleanups.push(async () => { await shutdown() })
  return {
    pi, logs, handlers, deferred, dispatchStart, flushStartup, shutdown, failures, routes,
    failureCount: () => failureCount,
    registered: registered.promise, requested: requested.promise,
    turn: (id = "A") => pi.dispatch("before_agent_start", { type: "before_agent_start" }, session(id)),
    start: async (id = "A") => { await dispatchStart(id); await flushStartup() },
    tools: () => pi.tools.filter((tool) => String(tool.name).startsWith("desktop_")),
  }
}

export async function mcp(options: {
  listFailure?: boolean; callFailure?: boolean; echoToken?: boolean; sse?: boolean; paginated?: boolean
  wrongId?: boolean; holdCall?: boolean; redirect?: boolean; tools?: readonly unknown[]
  holdList?: Promise<void>; deleteFailure?: boolean
  callResult?: unknown
  /** Answers tools/call; a rejection becomes a JSON-RPC error. Lets a test put a real host behind this transport. */
  onCall?: (params: unknown) => Promise<unknown>
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "desktop-thread-"))
  const tokenFile = join(dir, "bearer")
  let token = `test-credential-${crypto.randomUUID()}`
  await writeFile(tokenFile, token, { mode: 0o600 })
  const requests: { method: unknown; params: unknown; authorized: boolean }[] = []
  const sessions = new Map<string, boolean>()
  const callStarted = Promise.withResolvers<void>()
  const listStarted = Promise.withResolvers<void>()
  let closedSessions = 0
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const authorized = request.headers.get("authorization") === `Bearer ${token}`
      if (!authorized) return new Response("unauthorized", { status: 401 })
      const sessionId = request.headers.get("mcp-session-id")
      if (request.method === "DELETE" && sessionId !== null) {
        sessions.delete(sessionId)
        closedSessions++
        if (options.deleteFailure) return Response.redirect("http://127.0.0.1:1/never", 307)
        return new Response(null, { status: 204 })
      }
      if (request.method !== "POST") return new Response(null, { status: 405 })
      const body = await request.json()
      if (typeof body !== "object" || body === null || !("method" in body)) return new Response(null, { status: 400 })
      const id = "id" in body ? body.id : undefined
      const params = "params" in body ? body.params : undefined
      requests.push({ method: body.method, params, authorized })
      if (body.method !== "initialize") {
        if (sessionId === null || !sessions.has(sessionId) || request.headers.get("mcp-protocol-version") !== "2025-03-26") {
          return new Response("missing negotiated headers", { status: 400 })
        }
        if (body.method === "notifications/initialized" && id === undefined) {
          sessions.set(sessionId, true)
          return new Response(null, { status: 202 })
        }
        if (!sessions.get(sessionId)) return new Response("not initialized", { status: 400 })
      }
      let result: unknown
      const headers = new Headers()
      if (body.method === "initialize") {
        if (options.redirect) return new Response(null, { status: 307, headers: { location: "/mcp" } })
        const assigned = crypto.randomUUID()
        sessions.set(assigned, false)
        headers.set("mcp-session-id", assigned)
        result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "test-desktop", version: "1" } }
      } else if (body.method === "tools/list") {
        listStarted.resolve()
        await options.holdList
        if (options.listFailure) return new Response(token, { status: 500 })
        const cursor = typeof params === "object" && params !== null && "cursor" in params ? params.cursor : undefined
        result = options.paginated && cursor === undefined
          ? { tools: [], nextCursor: "second" }
          : { tools: options.tools ?? [{ name: "thread_organize", description: "Organize this desktop thread.", inputSchema: schema }] }
      } else if (body.method === "tools/call") {
        callStarted.resolve()
        if (options.holdCall) return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } })
        if (options.callFailure) return Response.json({ jsonrpc: "2.0", id, error: { code: -32603, message: token } })
        if (options.onCall !== undefined) {
          try {
            result = await options.onCall(params)
          } catch {
            return Response.json({ jsonrpc: "2.0", id, error: { code: -32603, message: "host call failed" } })
          }
        } else {
          result = options.callResult ?? { content: options.echoToken ? [{ type: "text", text: token }] : content }
        }
      } else {
        return new Response(null, { status: 400 })
      }
      const response = { jsonrpc: "2.0", id: options.wrongId ? "unrelated" : id, result }
      if (!options.sse) return Response.json(response, { headers })
      headers.set("content-type", "text/event-stream")
      const encoded = new TextEncoder().encode(`: keepalive\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\nevent: message\r\ndata: ${JSON.stringify(response).replace(",", ",\r\ndata: ")}\r\n\r\n`)
      let position = 0
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (position === encoded.length) return
          const end = Math.min(position + 7, encoded.length)
          controller.enqueue(encoded.slice(position, end))
          position = end
          // Keep the SSE response open: clients must stop on the matching response, not EOF.
        },
      }), { headers })
    },
  })
  cleanups.push(async () => { await server.stop(true); await rm(dir, { recursive: true, force: true }) })
  return {
    grant: { endpoint: `http://127.0.0.1:${server.port}/mcp`, tokenFile },
    requests, token: () => token, closedSessions: () => closedSessions, callStarted: callStarted.promise, listStarted: listStarted.promise,
    async rotate() { token = `rotated-${crypto.randomUUID()}`; await writeFile(tokenFile, token, { mode: 0o600 }) },
  }
}

export async function execute(tool: Record<string, unknown> | undefined, id = "A", signal?: AbortSignal) {
  if (typeof tool?.execute !== "function") throw new Error("desktop tool was not registered")
  return tool.execute("call-1", { title: "Grouped" }, signal, undefined, session(id))
}
