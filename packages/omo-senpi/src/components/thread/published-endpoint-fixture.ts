import { once } from "node:events"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection, createServer, type Socket } from "node:net"
import { join } from "node:path"
import { controlSocketSecretPath } from "./endpoint-registry"
import { createLiveThreadSurface } from "./live-surface"
import { createControlEndpointRegistrant, type SenpiWakeEvent } from "./gateway/registration"
import { createGatewayStore } from "./gateway/store"
import { FakeSessionRuntime } from "./gateway/testing/fake-runtime"
import { createThreadTools } from "./tools"
import { createThreadSdk } from "./sdk"

export async function publishedWorld() {
  const dir = mkdtempSync("/tmp/sgown-test-")
  const store = createGatewayStore({ agentDir: dir })
  const releases: Array<() => Promise<void>> = []
  const calls: string[] = []
  let discovery = 0
  // The engine's per-endpoint liveness verdicts as `host status --all` last reported them; sockets
  // without an entry are reported answering, with no verdict.
  const verdicts = new Map<string, { readonly alive: boolean; readonly reason: "live_unresponsive" | "dead" | null; readonly paths: readonly string[] }>()
  const surface = createLiveThreadSurface(undefined, {
    env: { SENPI_RPC_SOCKET: join(dir, "missing.sock") },
    statusAll: async () => {
      discovery++
      return calls.map((socket) => {
        const verdict = verdicts.get(socket)
        return verdict === undefined
          ? { socket, reachable: true, session_paths: [] }
          : { socket, reachable: verdict.alive, session_paths: [...verdict.paths], alive: verdict.alive, reason: verdict.reason }
      })
    },
    registry: async () => [],
    connect: (path) => createConnection(path),
  })
  const options = { host: surface, store, stateDirectory: dir, sessionsDirectory: () => join(dir, "sessions"), callerSessionId: () => "caller", callerWorkspaceRoot: () => dir }
  const tools = createThreadTools(options)
  let sequence = 0
  async function send(thread = "target") {
    const tool = tools.find((entry) => entry.name === "thread_send")
    if (tool === undefined) throw new Error("missing send")
    return (await tool.execute(`send-${++sequence}`, { thread, message: "hello" }, undefined, undefined, undefined as never)).details.result
  }
  async function owner(name: string, cwd = dir, durableId = "target", terminal = false) {
    const socketPath = join(dir, terminal ? "t-0123456789abcdef.sock" : `${name}.sock`)
    // A terminal endpoint authenticates every connection with its 32-byte secret before the first frame.
    if (terminal) writeFileSync(controlSocketSecretPath(socketPath), Buffer.alloc(32, 7))
    const sessionDir = join(dir, "sessions", "--test--")
    mkdirSync(sessionDir, { recursive: true })
    const sessionPath = join(sessionDir, `2026-10-02_${durableId}.jsonl`)
    writeFileSync(sessionPath, JSON.stringify({ type: "session", id: durableId, cwd, timestamp: "2026-10-02T00:00:00Z" }) + "\n")
    const runtime = new FakeSessionRuntime(sessionPath, durableId, cwd)
    let drain: ((event: SenpiWakeEvent) => unknown) | undefined
    const frames: string[] = []
    const listing = { answer: true, durableId, delayMs: 0 }
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
      let buffer = ""
      let authenticated = !terminal
      socket.on("data", (chunk) => {
        buffer += chunk.toString()
        if (!authenticated) {
          if (buffer.length < 32) return
          buffer = buffer.slice(32)
          authenticated = true
        }
        if (!buffer.includes("\n")) return
        const frame = JSON.parse(buffer.slice(0, buffer.indexOf("\n")))
        frames.push(frame.type)
        if (frame.type === "list_sessions" && !listing.answer) return
        void (async () => {
          if (frame.type === "list_sessions" && listing.delayMs > 0) await new Promise((done) => setTimeout(done, listing.delayMs))
          const data = frame.type === "list_sessions"
            ? { sessions: [{ sessionId: `route-${name}`, durableSessionId: listing.durableId, sessionPath, cwd, name, status: "open" }] }
            : await drain?.({ type: "session_control_wake", reason: "command", reasons: ["command"], delivery_ids: frame.delivery_ids })
          socket.end(JSON.stringify({ id: frame.id, success: true, data: data ?? {} }) + "\n")
        })()
      })
    })
    const listening = once(server, "listening", { signal: AbortSignal.timeout(5000) })
    server.listen(socketPath)
    await listening
    calls.push(socketPath)
    let closed = false
    async function crash() {
      if (closed) return
      closed = true
      const done = once(server, "close", { signal: AbortSignal.timeout(5000) })
      for (const socket of sockets) socket.destroy()
      server.close()
      await done
    }
    const registrant = createControlEndpointRegistrant({
      agentDir: () => dir, store, ...(terminal ? {} : { runtimeInstance: name }),
      control: {
        persistHeaderNow: async () => undefined,
        admissionGate: () => runtime.admissionGate(),
        admitExternalMessage: (input) => runtime.admitExternalMessage(input),
        listAdmittedDeliveries: () => runtime.listAdmittedDeliveries(),
        registerControlEndpoint: async (options) => {
          drain = options.drain
          return { status: "registered", socket: socketPath, dispose: crash }
        },
      },
    })
    const start = () => registrant.start({ durableId, sessionPath: () => sessionPath, isIdle: () => runtime.phase() === "idle" })
    await start()
    releases.push(async () => { await registrant.stop(); await crash() })
    return { frames, runtime, crash, stop: registrant.stop, start, socketPath, sessionPath, listing,
      connected: () => once(server, "connection", { signal: AbortSignal.timeout(5000) }),
    }
  }
  const sdk = createThreadSdk({ agentDir: dir, cwd: dir, uid: 123, user: "test", host: surface, store })
  return {
    dir, store, owner, send, sdk, discovery: () => discovery,
    /** The engine judged this socket `alive`/`reason` until the next enumeration; `paths` are its session files. */
    setVerdict: (socket: string, verdict: { readonly alive: boolean; readonly reason: "live_unresponsive" | "dead" | null; readonly paths: readonly string[] }) => verdicts.set(socket, verdict),
    async close() {
      for (const release of releases.reverse()) await release()
      await sdk.dispose()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
