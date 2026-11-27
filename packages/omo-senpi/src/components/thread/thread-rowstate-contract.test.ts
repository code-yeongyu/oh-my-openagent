import { afterEach, expect, test } from "bun:test"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeHostTransport } from "../../../../senpi-task/src/runners/rpc-host/__fixtures__/fake-host-transport"
import { createGatewayStore } from "./gateway/store"
import { createLiveThreadSurface } from "./live-surface"
import { createThreadTools } from "./tools"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"

const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

test("reading a held peer reports the same whitelisted hold as its row", async () => {
  const hold = {
    kind: "session_hold",
    key: "interrupted-run",
    since: new Date(0).toISOString(),
    queue_depth: 3,
  } as const
  const b = fixture.account({ rows: [{ ...B_ROW, liveness: { kind: "held", hold: { ...hold, data: "private" } } }] })
  const { run } = fixture.surface(b.remote)
  const list = await run("thread_list", { all_scope: true })
  if (!("threads" in list)) throw new Error("no rows")
  const row = list.threads.find((item) => item.thread === B_ROW.durable_id)
  expect(row?.state).toBe("held")
  expect(row?.hold).toEqual(hold)
  const read = await run("thread_read", { thread: B_ROW.durable_id, all_scope: true })
  expect(read).toMatchObject({ kind: "ok", state: "held", hold })
  expect(JSON.stringify(read)).not.toContain('"data":"private"')
})

test("device A preserves B's per-host evidence without treating a legacy row as verified", async () => {
  const legacy = { ...B_ROW, durable_id: "legacy", session_id: "r0" }
  const fast = { ...B_ROW, durable_id: "fast", session_id: "r1", liveness: { kind: "running", activity: "running" } }
  const slow = {
    ...B_ROW,
    durable_id: "slow",
    session_id: "r2",
    liveness: { kind: "unknown", host: "engine-b2", reason: "host_not_answering" },
  }
  const b = fixture.account({ rows: [legacy, fast, slow] })
  const { run } = fixture.surface(b.remote)
  const result = await run("thread_list", { all_scope: true })
  if (!("threads" in result)) throw new Error("no rows")
  const row = (id: string) => result.threads.find((item) => item.thread === id)
  expect(row("legacy")).toMatchObject({ state: "idle", verification: "unverified" })
  expect(row("fast")).toMatchObject({ state: "running", liveness: fast.liveness })
  expect(row("slow")).toMatchObject({ state: "unknown", liveness: slow.liveness })
  expect(result.devices?.find((device) => device.device === "b")).toMatchObject({ host_counts: null })
})

test("one host missing the listing deadline cannot turn its claimed session inactive", async () => {
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
    const host = createLiveThreadSurface(undefined, {
      env: { HOME: dir, SENPI_RPC_SOCKET: fast },
      exists: (path) => path === fast || path === slow,
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
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await new Promise<void>((resolve) => recovering.close(() => resolve()))
    await store.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
