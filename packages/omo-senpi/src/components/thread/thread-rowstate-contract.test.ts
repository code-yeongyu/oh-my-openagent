import { expect, test } from "bun:test"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeHostTransport } from "../../../../senpi-task/src/runners/rpc-host/__fixtures__/fake-host-transport"
import { createGatewayStore } from "./gateway/store"
import { createLiveThreadSurface } from "./live-surface"
import { createThreadTools } from "./tools"
test("one host missing the listing deadline cannot turn its claimed session inactive; once its socket is gone, it lists inactive (dead), never unknown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "row-"))
  const fast = join(dir, "rpc.sock")
  const slow = join(dir, "i-0123456789abcdef.sock")
  const file = join(dir, "slow.jsonl")
  const transport = fakeHostTransport(fast)
  const slowTransport = fakeHostTransport(slow)
  const store = createGatewayStore({ agentDir: dir })
  const serverFor = (endpoint: typeof transport, id: string) =>
    createServer((socket) =>
      endpoint.authenticate(socket, () => {
        socket.setEncoding("utf8")
        let pending = ""
        socket.on("data", (chunk) => {
          pending += chunk
          for (let end: number; (end = pending.indexOf("\n")) >= 0;) {
            const frame = JSON.parse(pending.slice(0, end))
            pending = pending.slice(end + 1)
            const data =
              frame.type === "list_sessions"
                ? { sessions: [{ sessionId: "rpc-1", durableSessionId: id, cwd: process.cwd(), activity: "running" }] }
                : { capabilities: ["session_row_hold"] }
            socket.write(
              `${JSON.stringify({ id: frame.id, type: "response", command: frame.type, success: true, data })}\n`,
            )
          }
        })
      }),
    )
  const server = serverFor(transport, "fast")
  const recovering = serverFor(slowTransport, "slow")
  try {
    writeFileSync(
      file,
      JSON.stringify({ type: "session", id: "slow", cwd: process.cwd(), timestamp: new Date(0).toISOString() }) + "\n",
    )
    const listening = once(server, "listening")
    server.listen(transport.listenAddress)
    await listening
    const ready = once(recovering, "listening")
    recovering.listen(slowTransport.listenAddress)
    await ready
    let now = 1000
    let expired = 0
    let fault = true
    let slowSocket = true
    const host = createLiveThreadSurface(undefined, {
      env: { HOME: dir, SENPI_RPC_SOCKET: fast },
      exists: (path) => path === fast || (path === slow && slowSocket),
      registry: async () => [],
      statusAll: async () => [
        { socket: fast, reachable: true, session_paths: [] },
        { socket: slow, reachable: true, session_paths: [file] },
      ],
      now: () => now,
      connect: (path) => {
        if (path === transport.listenAddress || !fault) return createConnection(path)
        now += 10_001
        expired++
        throw new Error("thread RPC request timed out")
      },
    })
    const tools = createThreadTools({
      host,
      store,
      stateDirectory: dir,
      callerSessionId: () => "caller",
      callerWorkspaceRoot: () => process.cwd(),
    })
    const list = tools.find((tool) => tool.name === "thread_list")
    if (!list) throw new Error("thread_list missing")
    const result = (await list.execute("list", { all_scope: true }, undefined, undefined, undefined as never)).details
      .result
    expect(expired).toBe(1)
    expect(result.kind).toBe("ok")
    expect(result).toHaveProperty("host_counts", { answered: 1, unanswered: 1 })
    if (!("threads" in result)) throw new Error("no rows")
    const rows: readonly { thread: string; state?: string }[] = result.threads
    expect(rows.find((row) => row.thread === "fast")?.state).toBe("running")
    const row = rows.find((row) => row.thread === "slow")
    // #15376 L1: the host that did not answer is named by an opaque id (16 hex of sha256), never by its socket path.
    expect(row).toMatchObject({
      liveness: { kind: "unknown", host: expect.stringMatching(/^[0-9a-f]{16}$/), reason: "host_not_answering" },
    })
    if (row?.state === "inactive") {
      expect(row).toMatchObject({ status: "resumable", state: "inactive", error_note: "live_unresponsive" })
    }
    expect(row).toMatchObject({ state: "unknown" })
    fault = false
    const cleared = (await list.execute("after", { all_scope: true }, undefined, undefined, undefined as never)).details
      .result
    expect(cleared).toHaveProperty("host_counts", { answered: 2, unanswered: 0 })
    if (!("threads" in cleared)) throw new Error("no rows after recovery")
    expect(cleared.threads.find((item: { thread: string }) => item.thread === "slow")).toMatchObject({
      state: "running",
      liveness: { kind: "running", activity: "running" },
    })
    // The slow host exits: a host that is gone holds nothing (row 29), so the session it still claims lists inactive,
    // never unknown as a host that did not answer. First as Windows sees it, where a pipe is no file: the socket still
    // "exists" and only the refused dial says the host is gone.
    await new Promise<void>((resolve) => recovering.close(() => resolve()))
    const refused = (await list.execute("refused", { all_scope: true }, undefined, undefined, undefined as never))
      .details.result
    if (!("threads" in refused)) throw new Error("no rows after the slow host stopped answering its dials")
    expect(refused).toHaveProperty("host_counts", { answered: 1, unanswered: 0 })
    expect(refused).not.toHaveProperty("listing")
    expect(refused.threads.find((item: { thread: string }) => item.thread === "slow")).toMatchObject({
      state: "inactive",
      liveness: { kind: "not_running" },
      error_note: `host_unavailable:${slow}`,
    })
    // Then as POSIX sees it: its socket file goes with it.
    slowSocket = false
    const gone = (await list.execute("gone", { all_scope: true }, undefined, undefined, undefined as never)).details
      .result
    if (!("threads" in gone)) throw new Error("no rows after the slow host exited")
    // Holding nothing, the gone host is neither an answer nor a missing one, and the listing is complete (#14308).
    expect(gone).toHaveProperty("host_counts", { answered: 1, unanswered: 0 })
    expect(gone).not.toHaveProperty("listing")
    expect(gone.threads.find((item: { thread: string }) => item.thread === "slow")).toMatchObject({
      state: "inactive",
      liveness: { kind: "not_running" },
      error_note: `host_unavailable:${slow}`,
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await new Promise<void>((resolve) => recovering.close(() => resolve()))
    await store.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
