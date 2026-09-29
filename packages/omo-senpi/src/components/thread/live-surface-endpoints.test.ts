import { afterEach, describe, expect, test } from "bun:test"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection, createServer, type Server, type Socket } from "node:net"
import { join } from "node:path"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { createLiveThreadSurface, HOST_ENDPOINTS_CACHE_TTL_MS, parseHostStatusAll, type HostEndpointReport } from "./live-surface"
import { createThreadTools } from "./tools"

type Frame = Record<string, unknown>
type Answer = (frame: Frame) => Record<string, unknown>

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function tempDir(prefix: string): string {
  // Short /tmp paths: a unix socket path is capped near 104 bytes on darwin.
  const directory = mkdtempSync(join("/tmp", prefix))
  cleanups.push(async () => rmSync(directory, { recursive: true, force: true }))
  return directory
}

async function endpoint(socketPath: string, answer: Answer): Promise<{ readonly frames: Frame[] }> {
  const frames: Frame[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
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
      socket.end(`${JSON.stringify({ id: frame.id, type: "response", command: frame.type, success: true, ...answer(frame) })}\n`)
    })
  })
  const listening = once(server, "listening", { signal: AbortSignal.timeout(2000) })
  server.listen(socketPath)
  await listening
  cleanups.push(async () => {
    const closed = once(server, "close", { signal: AbortSignal.timeout(2000) })
    for (const socket of sockets) socket.destroy()
    server.close()
    await closed
  })
  return { frames }
}

/** A host whose one listed session is `rpc-1` - the routing id EVERY host hands its first session. */
function hostWith(durableId: string, name: string, sessionPath: string): Answer {
  return (frame) => {
    switch (frame.type) {
      case "list_sessions": return { data: { sessions: [{ sessionId: "rpc-1", durableSessionId: durableId, sessionPath, cwd: process.cwd(), name, status: "open" }] } }
      case "get_state": return { data: { isStreaming: false } }
      case "prompt": return { data: { turnId: `turn-${durableId}` } }
      case "get_messages": return { data: { messages: [{ role: "assistant", content: `from ${durableId}` }] } }
      case "open_session": return { data: { sessionId: "rpc-2", state: { cwd: process.cwd() } } }
      default: return { data: {} }
    }
  }
}

function writeSessionJsonl(path: string, durableId: string, text: string): void {
  writeFileSync(path, [
    { type: "session", id: durableId, cwd: process.cwd(), timestamp: "2026-09-27T00:00:00.000Z" },
    { type: "session_info", name: "desktop-thread", timestamp: "2026-09-27T00:00:01.000Z" },
    { type: "model_change", provider: "openai", modelId: "gpt-x", timestamp: "2026-09-27T00:00:01.500Z" },
    { type: "thinking_level_change", thinkingLevel: "high", timestamp: "2026-09-27T00:00:01.600Z" },
    { type: "message", timestamp: "2026-09-27T00:00:02.000Z", message: { role: "user", content: text } },
    { type: "message", timestamp: "2026-09-27T00:00:03.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }] } },
    { type: "message", timestamp: "2026-09-27T00:00:04.000Z", message: { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "file body" }] } },
  ].map((entry) => `${JSON.stringify(entry)}\n`).join(""))
}

type World = {
  readonly legacy: string
  readonly shard: string
  readonly dialed: string[]
  readonly statusCalls: { count: number }
  readonly run: (name: ThreadToolName, args: unknown) => Promise<ThreadToolResult>
}

function world(options: { readonly reports: () => readonly HostEndpointReport[] | undefined; readonly legacy: string; readonly shard: string; readonly now?: () => number }): World {
  const dialed: string[] = []
  const statusCalls = { count: 0 }
  const surface = createLiveThreadSurface({} as never, {
    env: { SENPI_RPC_SOCKET: options.legacy },
    statusAll: async () => { statusCalls.count += 1; return options.reports() },
    registry: async () => [],
    connect: (path) => { dialed.push(path); return createConnection(path) },
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  const tools = createThreadTools({ host: surface, stateDirectory: tempDir("thr-state-"), callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() })
  let calls = 0
  return {
    legacy: options.legacy,
    shard: options.shard,
    dialed,
    statusCalls,
    run: async (name, args) => {
      const tool = tools.find((candidate) => candidate.name === name)
      if (tool === undefined) throw new Error(`${name} is not registered`)
      calls += 1
      return (await tool.execute(`call-${calls}`, args, undefined, undefined, undefined as never)).details.result as ThreadToolResult
    },
  }
}

const report = (socket: string, reachable: boolean, sessionPaths: readonly string[] = []): HostEndpointReport => ({ socket, reachable, session_paths: sessionPaths })

describe("thread tools across host endpoints", () => {
  test("#given host status --all answering the legacy endpoint and an i-* shard with one session each #when thread_list runs #then both threads are listed with their own sockets", async () => {
    // given
    const dir = tempDir("thr-ep-")
    const legacy = join(dir, "rpc.sock")
    const shard = join(dir, "i-0123456789abcdef.sock")
    await endpoint(legacy, hostWith("dur-terminal", "terminal", join(dir, "terminal.jsonl")))
    await endpoint(shard, hostWith("dur-desktop", "desktop", join(dir, "desktop.jsonl")))
    const w = world({ legacy, shard, reports: () => [report(legacy, true), report(shard, true)] })

    // when
    const listed = await w.run("thread_list", { all_scope: true })

    // then
    expect(listed.kind).toBe("ok")
    const threads = (listed as Extract<ThreadToolResult, { kind: "ok"; threads: unknown }>).threads as ReadonlyArray<{ thread_id: string; socket?: string; status: string }>
    expect(threads.map((thread) => [thread.thread_id, thread.socket, thread.status]).sort()).toEqual([["dur-desktop", shard, "live"], ["dur-terminal", legacy, "live"]])
  })

  test("#given both endpoints hold a session routed as rpc-1 #when thread_send and thread_read target the i-* thread #then every per-session request dials the i-* socket and none reaches the legacy one", async () => {
    // given
    const dir = tempDir("thr-ep-")
    const legacy = join(dir, "rpc.sock")
    const shard = join(dir, "i-0123456789abcdef.sock")
    const legacyHost = await endpoint(legacy, hostWith("dur-terminal", "terminal", join(dir, "terminal.jsonl")))
    const shardHost = await endpoint(shard, hostWith("dur-desktop", "desktop", join(dir, "desktop.jsonl")))
    const w = world({ legacy, shard, reports: () => [report(legacy, true), report(shard, true)] })

    // when
    const sent = await w.run("thread_send", { thread: "dur-desktop", message: "hello desktop" })
    const read = await w.run("thread_read", { thread: "dur-desktop" })

    // then
    expect(sent).toMatchObject({ kind: "ok", thread_id: "dur-desktop", delivery: { kind: "queued" }, endpoint: { kind: "rpc_host" } })
    expect(read).toMatchObject({ kind: "ok", source: "live_host", items: [{ role: "assistant", content: JSON.stringify("from dur-desktop") }] })
    const perSession = new Set(["wake", "get_messages"])
    const shardPerSession = shardHost.frames.filter((frame) => perSession.has(String(frame.type)))
    expect(new Set(shardPerSession.map((frame) => frame.type))).toEqual(perSession)
    expect(shardPerSession.every((frame) => frame.sessionId === "rpc-1")).toBe(true)
    expect(legacyHost.frames.filter((frame) => perSession.has(String(frame.type)))).toEqual([])
    expect(w.dialed.filter((path) => path === shard).length).toBeGreaterThanOrEqual(3)
  })

  test("#given two live endpoints #when thread_create runs #then open_session is sent to the legacy socket and the created thread names it", async () => {
    // given
    const dir = tempDir("thr-ep-")
    const legacy = join(dir, "rpc.sock")
    const shard = join(dir, "i-0123456789abcdef.sock")
    const legacyHost = await endpoint(legacy, hostWith("dur-terminal", "terminal", join(dir, "terminal.jsonl")))
    const shardHost = await endpoint(shard, hostWith("dur-desktop", "desktop", join(dir, "desktop.jsonl")))
    const w = world({ legacy, shard, reports: () => [report(legacy, true), report(shard, true)] })

    // when
    const created = await w.run("thread_create", {})

    // then
    expect(created).toMatchObject({ kind: "ok", thread: { sessionId: "rpc-2", socket: legacy } })
    expect(legacyHost.frames.some((frame) => frame.type === "open_session")).toBe(true)
    expect(shardHost.frames.some((frame) => frame.type === "open_session")).toBe(false)
  })

  test("#given the i-* endpoint stopped answering after it claimed a session file #when the tools run #then its thread comes from disk with error_note, reads from JSONL, and the legacy thread still takes sends", async () => {
    // given: the shard's socket path names nothing, its claimed session file survives
    const dir = tempDir("thr-ep-")
    const legacy = join(dir, "rpc.sock")
    const shard = join(dir, "i-0123456789abcdef.sock")
    const desktopJsonl = join(dir, "desktop.jsonl")
    writeSessionJsonl(desktopJsonl, "dur-desktop", "hello from disk")
    const legacyHost = await endpoint(legacy, hostWith("dur-terminal", "terminal", join(dir, "terminal.jsonl")))
    const w = world({ legacy, shard, reports: () => [report(legacy, true), report(shard, false, [desktopJsonl])] })

    // when
    const listed = await w.run("thread_list", { all_scope: true })
    const read = await w.run("thread_read", { thread: "dur-desktop" })
    const sent = await w.run("thread_send", { thread: "dur-terminal", message: "still here" })

    // then
    const threads = (listed as Extract<ThreadToolResult, { kind: "ok"; threads: unknown }>).threads as ReadonlyArray<{ thread_id: string; status: string; socket?: string; error_note?: string }>
    const desktop = threads.find((thread) => thread.thread_id === "dur-desktop")
    expect(desktop).toMatchObject({ status: "resumable", socket: shard, error_note: `host_unavailable:${shard}` })
    expect(threads.find((thread) => thread.thread_id === "dur-terminal")).toMatchObject({ status: "live", socket: legacy })
    expect(read).toMatchObject({ kind: "ok", source: "session_jsonl", source_incomplete: true, error_note: `host_unavailable:${shard}` })
    expect((read as { items: ReadonlyArray<{ seq: number; role: string; content: string }> }).items).toEqual([
      { seq: 1, role: "user", content: JSON.stringify("hello from disk") },
      { seq: 2, role: "assistant", content: JSON.stringify([{ type: "toolCall", id: "c1", name: "read", arguments: {} }]) },
      { seq: 3, role: "tool", content: JSON.stringify([{ type: "text", text: "file body" }]) },
    ])
    expect(sent).toMatchObject({ kind: "ok", thread_id: "dur-terminal" })
    expect(legacyHost.frames.some((frame) => frame.type === "wake")).toBe(true)
    expect(w.dialed).not.toContain(shard)
  })

  test("#given thread tools listing and acting on both endpoints #when the frames are inspected #then every list_sessions is an observing read and no request that acts on a session is", async () => {
    // given
    const dir = tempDir("thr-ep-")
    const legacy = join(dir, "rpc.sock")
    const shard = join(dir, "i-0123456789abcdef.sock")
    const legacyHost = await endpoint(legacy, hostWith("dur-terminal", "terminal", join(dir, "terminal.jsonl")))
    const shardHost = await endpoint(shard, hostWith("dur-desktop", "desktop", join(dir, "desktop.jsonl")))
    const w = world({ legacy, shard, reports: () => [report(legacy, true), report(shard, true)] })

    // when
    await w.run("thread_list", { all_scope: true })
    await w.run("thread_send", { thread: "dur-desktop", message: "hello" })
    await w.run("thread_create", { name: "fresh" })

    // then
    const frames = [...legacyHost.frames, ...shardHost.frames]
    const listings = frames.filter((frame) => frame.type === "list_sessions")
    const acting = frames.filter((frame) => frame.type !== "list_sessions")
    expect(listings.length).toBeGreaterThanOrEqual(4)
    expect(listings.every((frame) => frame.observe === true)).toBe(true)
    expect(acting.map((frame) => frame.type)).toEqual(expect.arrayContaining(["wake", "open_session", "set_session_name"]))
    expect(acting.some((frame) => "observe" in frame)).toBe(false)
  })

  test("#given an engine that cannot enumerate and no legacy socket #when any tool runs #then it answers host_unavailable as data", async () => {
    // given
    const dir = tempDir("thr-ep-")
    const legacy = join(dir, "rpc.sock")
    const w = world({ legacy, shard: join(dir, "unused.sock"), reports: () => undefined })

    // when
    const results = [
      await w.run("thread_list", {}),
      await w.run("thread_create", {}),
      await w.run("thread_read", { thread: "anything" }),
      await w.run("thread_send", { thread: "anything", message: "x" }),
    ]

    // then
    for (const result of results) expect(result).toMatchObject({ kind: "error", error: { code: "host_unavailable" } })
    expect(w.dialed).toEqual([])
  })

  test("#given an engine that cannot enumerate but a live legacy socket #when thread_list runs #then the legacy endpoint alone answers, as before enumeration existed", async () => {
    // given
    const dir = tempDir("thr-ep-")
    const legacy = join(dir, "rpc.sock")
    await endpoint(legacy, hostWith("dur-terminal", "terminal", join(dir, "terminal.jsonl")))
    const w = world({ legacy, shard: join(dir, "unused.sock"), reports: () => undefined })

    // when
    const listed = await w.run("thread_list", { all_scope: true })

    // then
    expect(listed).toMatchObject({ kind: "ok", threads: [{ thread_id: "dur-terminal", socket: legacy }] })
  })

  test("#given repeated calls #when they land inside and then past the cache window #then host status --all runs once per window", async () => {
    // given
    const dir = tempDir("thr-ep-")
    const legacy = join(dir, "rpc.sock")
    await endpoint(legacy, hostWith("dur-terminal", "terminal", join(dir, "terminal.jsonl")))
    let clock = 1_000
    const w = world({ legacy, shard: join(dir, "unused.sock"), reports: () => [report(legacy, true)], now: () => clock })

    // when
    await w.run("thread_list", {})
    clock += HOST_ENDPOINTS_CACHE_TTL_MS - 1
    await w.run("thread_list", {})
    const withinWindow = w.statusCalls.count
    clock += 1
    await w.run("thread_list", {})

    // then
    expect(withinWindow).toBe(1)
    expect(w.statusCalls.count).toBe(2)
  })
})

describe("host status --all parsing", () => {
  test("#given the engine's --all line #when parsed #then every addressable endpoint keeps its socket, reachability, and the session files its rows and claims name", () => {
    const line = JSON.stringify({
      endpoints: [
        { socket: "/a/rpc/rpc.sock", reachable: true, shard: null, session_rows: [{ id: "rpc-1", kind: "interactive", session_path: "/s/one.jsonl", attachments: 1, context: null }], claims: [] },
        { socket: "/a/rpc/shards/i-0123456789abcdef.sock", reachable: false, shard: { kind: "i", key: "0123456789abcdef" }, session_rows: [], claims: [{ session_path: "/s/two.jsonl", owner_pid: 1, instance_id: "x", generation: null, attached: null, live: false }] },
        { socket: null, reachable: false, shard: null, session_rows: [], claims: [] },
      ],
    })
    expect(parseHostStatusAll(`${line}\n`)).toEqual([
      { socket: "/a/rpc/rpc.sock", reachable: true, session_paths: ["/s/one.jsonl"] },
      { socket: "/a/rpc/shards/i-0123456789abcdef.sock", reachable: false, session_paths: ["/s/two.jsonl"] },
      { socket: null, reachable: false, session_paths: [] },
    ])
  })

  test("#given a pre-release engine's usage error #when parsed #then enumeration is unavailable", () => {
    expect(parseHostStatusAll("")).toBeUndefined()
    expect(parseHostStatusAll(undefined)).toBeUndefined()
    expect(parseHostStatusAll(`${JSON.stringify({ action: "error", reason: "host_error" })}\n`)).toBeUndefined()
  })
})
