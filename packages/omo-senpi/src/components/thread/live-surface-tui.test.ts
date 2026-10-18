import { afterEach, describe, expect, test } from "bun:test"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection, createServer, type Server, type Socket } from "node:net"
import { join } from "node:path"

import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { createLiveThreadSurface, parseHostStatusAll, TUI_ENDPOINT_COMMANDS, type HostEndpointReport } from "./live-surface"
import { createGatewayStore } from "./gateway/store"
import { createThreadTools } from "./tools"

type Frame = Record<string, unknown>

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join("/tmp", prefix))
  cleanups.push(async () => rmSync(directory, { recursive: true, force: true }))
  return directory
}

async function listen(server: Server, socketPath: string, sockets: Set<Socket>): Promise<void> {
  const listening = once(server, "listening", { signal: AbortSignal.timeout(2000) })
  server.listen(socketPath)
  await listening
  cleanups.push(async () => {
    const closed = once(server, "close", { signal: AbortSignal.timeout(2000) })
    for (const socket of sockets) socket.destroy()
    server.close()
    await closed
  })
}

const SECRET = Buffer.alloc(32, 7)

/**
 * A terminal control endpoint as senpi's `session-control-server.ts` serves it: the first 32 bytes of
 * every connection must be the secret (else the connection is dropped), then JSONL requests answered
 * from `session-control-commands.ts`'s surface; every other command is `unsupported` as data.
 */
type TerminalControls = { model: { provider: string; id: string }; level: string; running: boolean }

async function tuiEndpoint(socketPath: string, session: { id: string; path: string; name: string | null }, controls?: TerminalControls): Promise<{ readonly frames: Frame[]; readonly rejected: { count: number } }> {
  writeFileSync(`${socketPath}.secret`, SECRET)
  const frames: Frame[] = []
  const rejected = { count: 0 }
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    let authenticated = false
    let pending = Buffer.alloc(0)
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])
      if (!authenticated) {
        if (pending.length < SECRET.length) return
        if (!pending.subarray(0, SECRET.length).equals(SECRET)) { rejected.count += 1; socket.destroy(); return }
        authenticated = true
        pending = pending.subarray(SECRET.length)
      }
      const text = pending.toString("utf8")
      const newline = text.indexOf("\n")
      if (newline < 0) return
      const frame = JSON.parse(text.slice(0, newline)) as Frame
      pending = Buffer.from(text.slice(newline + 1), "utf8")
      frames.push(frame)
      const reply = (body: Record<string, unknown>) => socket.end(`${JSON.stringify({ id: frame.id, type: "response", command: frame.type, ...body })}\n`)
      switch (frame.type) {
        case "list_sessions": return reply({ success: true, data: { sessions: [{ sessionId: session.id, sessionPath: session.path, session_file: session.path, kind: "interactive", surface: "tui", cwd: process.cwd(), name: session.name, created_at: "2026-09-28T04:19:00.000Z", updated_at: "2026-09-28T04:23:30.000Z", attachments: 1 }] } })
        case "get_messages": return reply({ success: true, data: { messages: [{ role: "assistant", content: "from the terminal" }] } })
        case "get_state": return reply({ success: true, data: { isStreaming: false, turn_epoch: 3 } })
        case "set_session_name": return reply({ success: true })
        case "wake": return reply({ success: true, data: { admitted: (frame.delivery_ids as string[]).map((id) => ({ delivery_id: id, kind: "started" })) } })
        default: return controls === undefined ? reply({ success: false, error: "unsupported" }) : reply(sessionControl(frame, controls))
      }
    })
  })
  await listen(server, socketPath, sockets)
  return { frames, rejected }
}

const TERMINAL_MODELS = [{ provider: "faux", id: "faux-reasoner", name: "Faux Reasoner" }, { provider: "faux", id: "faux-plain", name: "Faux Plain" }]

/** senpi's terminal session controls (`session-control-session-commands.ts`), answered as that module answers them. */
function sessionControl(frame: Frame, controls: TerminalControls): Record<string, unknown> {
  switch (frame.type) {
    case "get_protocol_info": return { success: true, data: { mode: "tui", commands: ["get_protocol_info", "list_sessions", "get_state", "get_messages", "set_session_name", "subscribe", "wake", "extension_ui_response", "get_available_models", "get_available_thinking_levels", "set_model", "set_thinking_level", "interrupt"] } }
    case "get_available_models": return { success: true, data: { models: TERMINAL_MODELS } }
    case "get_available_thinking_levels": return { success: true, data: { levels: controls.model.id === "faux-plain" ? ["off"] : ["off", "low", "medium", "high"] } }
    case "set_model": {
      const model = TERMINAL_MODELS.find((candidate) => candidate.provider === frame.provider && candidate.id === frame.modelId)
      if (model === undefined) return { success: false, error: `Model not found: ${String(frame.provider)}/${String(frame.modelId)}` }
      controls.model = { provider: model.provider, id: model.id }
      return { success: true, data: model }
    }
    case "set_thinking_level": {
      const levels = controls.model.id === "faux-plain" ? ["off"] : ["off", "low", "medium", "high"]
      if (!levels.includes(String(frame.level))) return { success: false, error: `Thinking level ${String(frame.level)} is not supported by the active model.` }
      controls.level = String(frame.level)
      return { success: true }
    }
    case "interrupt": {
      if (!controls.running) return { success: true, data: { interrupted: false } }
      controls.running = false
      return { success: true, data: { interrupted: true, turnId: "3" } }
    }
    default: return { success: false, error: "unsupported" }
  }
}

async function hostEndpoint(socketPath: string, replies: Readonly<Record<string, unknown>> = {}): Promise<{ readonly frames: Frame[] }> {
  const frames: Frame[] = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    let buffer = ""
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      const frame = JSON.parse(buffer.slice(0, newline)) as Frame
      buffer = buffer.slice(newline + 1)
      frames.push(frame)
      const type = String(frame.type)
      const data = Object.hasOwn(replies, type) ? replies[type] : type === "list_sessions"
        ? { sessions: [{ sessionId: "rpc-1", durableSessionId: "dur-host", cwd: process.cwd(), name: "host-thread", status: "open", kind: "interactive" }] }
        : frame.type === "wake" ? { admitted: [] } : {}
      socket.end(`${JSON.stringify({ id: frame.id, type: "response", command: frame.type, success: true, data })}\n`)
    })
  })
  await listen(server, socketPath, sockets)
  return { frames }
}

function surfaceFor(legacy: string, reports: readonly HostEndpointReport[], options: { readonly secret?: Buffer } = {}) {
  const dialed: string[] = []
  const surface = createLiveThreadSurface({} as never, {
    env: { SENPI_RPC_SOCKET: legacy },
    statusAll: async () => reports,
    registry: async () => [],
    ...(options.secret === undefined ? {} : { readSecret: () => options.secret as Buffer }),
    connect: (path) => { dialed.push(path); return createConnection(path) },
  })
  const stateDirectory = tempDir("thr-tui-state-")
  // closed before its directory is removed: win32 cannot delete the open database
  const store = createGatewayStore({ agentDir: stateDirectory })
  cleanups.push(() => store.dispose())
  const tools = createThreadTools({ host: surface, store, stateDirectory, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() })
  let calls = 0
  const run = async (name: ThreadToolName, args: unknown): Promise<ThreadToolResult> => {
    const tool = tools.find((candidate) => candidate.name === name)
    if (tool === undefined) throw new Error(`${name} is not registered`)
    calls += 1
    return (await tool.execute(`call-${calls}`, args, undefined, undefined, undefined as never)).details.result as ThreadToolResult
  }
  return { surface, run, dialed }
}

type ListedThread = { controls?: readonly string[]; thread_id: string; name: string; surface?: string; alive?: boolean; created_at: string; endpoint?: { kind: string; socket: string; routing_id: string | null }; error_note?: string; status: string }
function threadsOf(result: ThreadToolResult): readonly ListedThread[] {
  if (result.kind !== "ok" || !("threads" in result)) throw new Error(`expected a thread list, got ${JSON.stringify(result)}`)
  return result.threads as unknown as readonly ListedThread[]
}

describe("thread tools over a terminal (tui) endpoint", () => {
  test("#given a live terminal endpoint and a host #when thread_list runs #then the terminal row carries endpoint.kind tui, surface tui, its real name and ISO timestamps, and was reached with its secret", async () => {
    // given
    const dir = tempDir("thr-tui-")
    const legacy = join(dir, "rpc.sock")
    const tui = join(dir, "t-0123456789abcdef.sock")
    const host = await hostEndpoint(legacy)
    const terminal = await tuiEndpoint(tui, { id: "dur-tui", path: join(dir, "tui.jsonl"), name: "my-tui" })
    const w = surfaceFor(legacy, [{ socket: legacy, reachable: true, session_paths: [], endpoint_kind: "rpc_host", alive: true, reason: null }, { socket: tui, reachable: true, session_paths: [], endpoint_kind: "tui", alive: true, reason: null }])

    // when
    const threads = threadsOf(await w.run("thread_list", { all_scope: true }))

    // then
    expect(threads.find((thread) => thread.thread_id === "dur-tui")).toMatchObject({ name: "my-tui", surface: "tui", alive: true, status: "live", created_at: "2026-09-28T04:19:00.000Z", endpoint: { kind: "tui", socket: tui, routing_id: "dur-tui" } })
    expect(threads.find((thread) => thread.thread_id === "dur-host")).toMatchObject({ surface: "daemon", endpoint: { kind: "rpc_host", socket: legacy, routing_id: "rpc-1" } })
    expect(terminal.rejected.count).toBe(0)
    expect(terminal.frames.map((frame) => frame.type).sort()).toEqual(["get_protocol_info", "list_sessions"])
    expect(terminal.frames.some((frame) => "observe" in frame)).toBe(false)
    expect(host.frames.every((frame) => frame.type !== "list_sessions" || frame.observe === true)).toBe(true)
  })

  test("#given a terminal target #when thread_send runs #then it is queued for the terminal's own inbox and woken; thread_interrupt, thread_set_model and thread_set_reasoning answer unsupported as data; the terminal never receives prompt, steer, follow_up, open_session or any host-only command", async () => {
    // given
    const dir = tempDir("thr-tui-")
    const legacy = join(dir, "rpc.sock")
    const tui = join(dir, "t-0123456789abcdef.sock")
    await hostEndpoint(legacy)
    const terminal = await tuiEndpoint(tui, { id: "dur-tui", path: join(dir, "tui.jsonl"), name: "my-tui" })
    const w = surfaceFor(legacy, [{ socket: tui, reachable: true, session_paths: [], endpoint_kind: "tui", alive: true, reason: null }])

    // when
    const sentMessage = await w.run("thread_send", { thread: "dur-tui", message: "hello", all_scope: true })
    const results = [
      await w.run("thread_interrupt", { thread: "dur-tui", all_scope: true }),
      await w.run("thread_set_model", { thread: "dur-tui", model: "anything", all_scope: true }),
      await w.run("thread_set_reasoning", { thread: "dur-tui", level: "high", all_scope: true }),
    ]
    const renamed = await w.run("thread_rename", { thread: "dur-tui", name: "renamed-tui", all_scope: true })
    const read = await w.run("thread_read", { thread: "dur-tui", all_scope: true })

    // then
    expect(sentMessage).toMatchObject({ kind: "ok", thread_id: "dur-tui", delivery: { kind: "queued" }, endpoint: { kind: "tui" } })
    for (const result of results) expect(result).toMatchObject({ kind: "error", error: { code: "unsupported" } })
    expect(renamed).toMatchObject({ kind: "ok", name: "renamed-tui" })
    expect(read).toMatchObject({ kind: "ok", source: "live_host" })
    const sent = new Set(terminal.frames.map((frame) => String(frame.type)))
    for (const type of sent) expect(TUI_ENDPOINT_COMMANDS.has(type)).toBe(true)
    expect(sent.has("wake")).toBe(true)
    for (const forbidden of ["prompt", "steer", "follow_up", "open_session", "interrupt", "set_model", "get_available_models", "set_thinking_level", "release_session"]) expect(sent.has(forbidden)).toBe(false)
  })

  test("#given a terminal whose engine has session controls #when the thread tools act on it #then the model switches, an unsupported level and an unknown model are refused with their reasons, an interrupt answers whether it stopped a turn, and thread_list says which controls each endpoint takes", async () => {
    // given
    const dir = tempDir("thr-tui-")
    const legacy = join(dir, "rpc.sock")
    const current = join(dir, "t-0123456789abcdef.sock")
    const older = join(dir, "t-fedcba9876543210.sock")
    await hostEndpoint(legacy)
    const state: TerminalControls = { model: { provider: "faux", id: "faux-reasoner" }, level: "medium", running: true }
    const terminal = await tuiEndpoint(current, { id: "dur-new", path: join(dir, "new.jsonl"), name: "new-tui" }, state)
    await tuiEndpoint(older, { id: "dur-old", path: join(dir, "old.jsonl"), name: "old-tui" })
    const w = surfaceFor(legacy, [
      { socket: legacy, reachable: true, session_paths: [], endpoint_kind: "rpc_host", alive: true, reason: null },
      { socket: current, reachable: true, session_paths: [], endpoint_kind: "tui", alive: true, reason: null },
      { socket: older, reachable: true, session_paths: [], endpoint_kind: "tui", alive: true, reason: null },
    ])

    // when
    const listed = threadsOf(await w.run("thread_list", { all_scope: true }))
    const reasoning = await w.run("thread_set_reasoning", { thread: "dur-new", level: "high", scope: "turn", all_scope: true })
    const interrupted = await w.run("thread_interrupt", { thread: "dur-new", all_scope: true })
    const idle = await w.run("thread_interrupt", { thread: "dur-new", all_scope: true })
    const unknown = await w.run("thread_set_model", { thread: "dur-new", model: "no-such-model", all_scope: true })
    const switched = await w.run("thread_set_model", { thread: "dur-new", model: "faux-plain", all_scope: true })
    const refused = await w.run("thread_set_reasoning", { thread: "dur-new", level: "high", all_scope: true })
    const olderRefused = await w.run("thread_set_model", { thread: "dur-old", model: "faux-plain", all_scope: true })

    // then
    expect(listed.find((thread) => thread.thread_id === "dur-new")?.controls).toEqual(["send", "read", "rename", "set_model", "set_reasoning", "interrupt"])
    expect(listed.find((thread) => thread.thread_id === "dur-old")?.controls).toEqual(["send", "read", "rename"])
    expect(listed.find((thread) => thread.thread_id === "dur-host")?.controls).toEqual(["send", "read", "rename", "set_model", "set_reasoning", "interrupt"])
    expect(reasoning).toMatchObject({ kind: "ok", level: "high", scope: "turn" })
    expect(interrupted).toMatchObject({ kind: "ok", thread_id: "dur-new", interrupted: true, turn_id: "3" })
    expect(idle).toMatchObject({ kind: "ok", interrupted: false })
    expect(unknown).toMatchObject({ kind: "error", error: { code: "model_not_found" } })
    expect(switched).toMatchObject({ kind: "ok", model: { provider: "faux", id: "faux-plain" } })
    expect(state.model).toEqual({ provider: "faux", id: "faux-plain" })
    expect(refused).toMatchObject({ kind: "error", error: { code: "thinking_level_unsupported", details: { supported: ["off"] } } })
    expect(state.level).toBe("high")
    expect(olderRefused).toMatchObject({ kind: "error", error: { code: "unsupported" } })
    expect(terminal.frames.filter((frame) => frame.type === "get_protocol_info")).toHaveLength(1)
  })

  test("#given the engine reports a stopped terminal live_unresponsive #when thread_list runs #then the terminal is not dialed and its thread shows alive false with error_note live_unresponsive from disk", async () => {
    // given
    const dir = tempDir("thr-tui-")
    const legacy = join(dir, "rpc.sock")
    const tui = join(dir, "t-0123456789abcdef.sock")
    const sessionPath = join(dir, "tui.jsonl")
    writeFileSync(sessionPath, `${[
      { type: "session", version: 3, id: "dur-tui", timestamp: "2026-09-28T04:19:00.000Z", cwd: process.cwd() },
      { type: "session_info", id: "n", parentId: null, timestamp: "2026-09-28T04:20:00.000Z", name: "my-tui" },
      { type: "message", id: "m", parentId: "n", timestamp: "2026-09-28T04:21:00.000Z", message: { role: "user", content: "hello" } },
    ].map((line) => JSON.stringify(line)).join("\n")}\n`)
    await hostEndpoint(legacy)
    const terminal = await tuiEndpoint(tui, { id: "dur-tui", path: sessionPath, name: "my-tui" })
    const w = surfaceFor(legacy, [{ socket: tui, reachable: false, session_paths: [sessionPath], endpoint_kind: "tui", alive: false, reason: "live_unresponsive" }])

    // when
    const threads = threadsOf(await w.run("thread_list", { all_scope: true }))

    // then
    expect(threads.find((thread) => thread.thread_id === "dur-tui")).toMatchObject({ status: "resumable", alive: false, error_note: "live_unresponsive", name: "my-tui", created_at: "2026-09-28T04:19:00.000Z", surface: "tui" })
    expect(terminal.frames).toEqual([])
    expect(w.dialed).not.toContain(tui)
  })

  test("#given a registry row for a terminal whose socket and secret are gone #when thread_list runs #then its thread reports error_note dead, not a raw host_unavailable path", async () => {
    // given: the engine still lists the endpoint (its directory outlived the process) but the terminal exited
    const dir = tempDir("thr-tui-")
    const legacy = join(dir, "rpc.sock")
    const tui = join(dir, "t-0123456789abcdef.sock")
    const sessionPath = join(dir, "tui.jsonl")
    writeFileSync(sessionPath, `${JSON.stringify({ type: "session", version: 3, id: "dur-gone", timestamp: "2026-09-28T04:19:00.000Z", cwd: process.cwd() })}\n`)
    await hostEndpoint(legacy)
    const w = surfaceFor(legacy, [{ socket: tui, reachable: false, session_paths: [sessionPath], endpoint_kind: "tui" }])

    // when
    const threads = threadsOf(await w.run("thread_list", { all_scope: true }))

    // then
    const gone = threads.find((thread) => thread.thread_id === "dur-gone")
    expect(gone).toMatchObject({ status: "resumable", alive: false, error_note: "dead", surface: "tui" })
    expect(JSON.stringify(gone)).not.toContain("host_unavailable")
    expect(w.dialed).not.toContain(tui)
  })

  test("#given a wrong secret #when a terminal is listed #then the connection is refused by the endpoint and the thread tools report it unreachable instead of hanging", async () => {
    const dir = tempDir("thr-tui-")
    const legacy = join(dir, "rpc.sock")
    const tui = join(dir, "t-0123456789abcdef.sock")
    await hostEndpoint(legacy)
    const terminal = await tuiEndpoint(tui, { id: "dur-tui", path: join(dir, "tui.jsonl"), name: "my-tui" })
    const w = surfaceFor(legacy, [{ socket: tui, reachable: true, session_paths: [], endpoint_kind: "tui", alive: true, reason: null }], { secret: Buffer.alloc(32, 9) })
    const threads = threadsOf(await w.run("thread_list", { all_scope: true }))
    // every connection the listing opened (sessions and the protocol probe) was refused
    expect(terminal.rejected.count).toBeGreaterThan(0)
    expect(terminal.rejected.count).toBe(w.dialed.filter((path) => path === tui).length)
    expect(threads.some((thread) => thread.thread_id === "dur-tui")).toBe(false)
  })

  test("#given the gateway sender port #when a terminal and a host are woken #then wake carries the delivery ids (and the routing id only on a host), a terminal refuses release_session, and liveness follows the engine verdict", async () => {
    // given
    const dir = tempDir("thr-tui-")
    const legacy = join(dir, "rpc.sock")
    const tui = join(dir, "t-0123456789abcdef.sock")
    const host = await hostEndpoint(legacy)
    const terminal = await tuiEndpoint(tui, { id: "dur-tui", path: join(dir, "tui.jsonl"), name: null })
    const w = surfaceFor(legacy, [{ socket: legacy, reachable: true, session_paths: [], endpoint_kind: "rpc_host", alive: true, reason: null }, { socket: tui, reachable: true, session_paths: [], endpoint_kind: "tui", alive: true, reason: null }])

    // when
    const tuiWake = await w.surface.gateway.wake({ kind: "tui", socket: tui, routing_id: "dur-tui" }, ["d1"])
    const hostWake = await w.surface.gateway.wake({ kind: "rpc_host", socket: legacy, routing_id: "rpc-1" }, ["d2"])
    const liveness = await w.surface.gateway.classifyLiveness?.({ kind: "tui", socket: tui, routing_id: "dur-tui" })
    const release = await (w.surface.gateway.releaseSession?.({ kind: "tui", socket: tui, routing_id: "dur-tui" }, { reason: "takeover" }) ?? Promise.resolve(undefined)).then(() => "released", (error: unknown) => (error instanceof Error ? error.message : String(error)))

    // then
    expect(tuiWake).toEqual({ admitted: [{ delivery_id: "d1", kind: "started" }] })
    expect(hostWake).toEqual({ admitted: [] })
    expect(terminal.frames.find((frame) => frame.type === "wake")).toMatchObject({ delivery_ids: ["d1"] })
    expect("sessionId" in (terminal.frames.find((frame) => frame.type === "wake") ?? {})).toBe(false)
    expect(host.frames.find((frame) => frame.type === "wake")).toMatchObject({ sessionId: "rpc-1", delivery_ids: ["d2"] })
    expect(release).toBe("unsupported:release_session")
    expect(liveness).toBe("routable")
    expect(host.frames.some((frame) => frame.type === "prompt")).toBe(false)
  })

  test("#given a host whose release reply says released but names no session path #when the session is released #then it is a failed release, not a success to relaunch from", async () => {
    const dir = tempDir("thr-tui-")
    const legacy = join(dir, "rpc.sock")
    const endpoint = { kind: "rpc_host", socket: legacy, routing_id: "rpc-1" } as const
    await hostEndpoint(legacy, { release_session: { released: true, attachments: 0, dropped: { deliveries: [], user_messages: [] } } })
    const w = surfaceFor(legacy, [{ socket: legacy, reachable: true, session_paths: [], endpoint_kind: "rpc_host", alive: true, reason: null }])
    expect(await w.surface.gateway.releaseSession?.(endpoint, { reason: "takeover" })).toEqual({ success: false, error: "release_failed" })
  })

  test("#given an engine that cannot enumerate #when the registry on disk names a terminal #then the terminal is listed from the registry", async () => {
    const dir = tempDir("thr-tui-")
    const legacy = join(dir, "rpc.sock")
    const tui = join(dir, "t-0123456789abcdef.sock")
    await hostEndpoint(legacy)
    await tuiEndpoint(tui, { id: "dur-tui", path: join(dir, "tui.jsonl"), name: "from-registry" })
    const surface = createLiveThreadSurface({} as never, {
      env: { SENPI_RPC_SOCKET: legacy },
      statusAll: async () => undefined,
      registry: async () => [{ socket: tui, dir: join(dir, "0123456789abcdef"), identity: "endpoint", endpoint_kind: "tui", registry_version: 1 }],
    })
    const view = await surface.listView?.()
    expect(view?.sessions.find((session) => session.durableSessionId === "dur-tui")).toMatchObject({ endpoint_kind: "tui", name: "from-registry", socket: tui })
  })
})

describe("host status --all rows with endpoint kinds", () => {
  test("#given a tui row with owner and a host row with a liveness verdict #when parsed #then kind, alive, reason and the owner's session path are kept", () => {
    const line = JSON.stringify({
      endpoints: [
        { socket: "/a/rpc/tui/t-0123456789abcdef.sock", reachable: true, endpoint_kind: "tui", alive: true, reason: null, owner: { pid: 42, cwd: "/w", session: { id: "dur-tui", path: "/s/tui.jsonl", name: "my-tui" } }, session_rows: [], claims: [] },
        { socket: "/a/rpc/shards/p-0123456789abcdef.sock", reachable: false, endpoint_kind: "rpc_host", alive: false, reason: "live_unresponsive", owner: null, session_rows: [], claims: [] },
        { socket: "/a/rpc/rpc.sock", reachable: true, session_rows: [], claims: [] },
      ],
    })
    expect(parseHostStatusAll(line)).toEqual([
      { socket: "/a/rpc/tui/t-0123456789abcdef.sock", reachable: true, session_paths: ["/s/tui.jsonl"], endpoint_kind: "tui", alive: true, reason: null },
      { socket: "/a/rpc/shards/p-0123456789abcdef.sock", reachable: false, session_paths: [], endpoint_kind: "rpc_host", alive: false, reason: "live_unresponsive" },
      { socket: "/a/rpc/rpc.sock", reachable: true, session_paths: [] },
    ])
  })
})
