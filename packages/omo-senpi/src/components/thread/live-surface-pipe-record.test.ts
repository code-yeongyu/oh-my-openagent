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

// On win32 a host is reached through a pipe named from its `<socket>.secret` record (#15392). The surface speaks that
// transport here on every platform: the answering host's pipe is served on a socket file its dial is routed to.
async function listBesideClaimedHost(record: Uint8Array | undefined) {
  const dir = mkdtempSync(join(tmpdir(), "pipe-record-"))
  const answering = join(dir, "rpc.sock")
  const claimed = join(dir, "i-0123456789abcdef.sock")
  const file = join(dir, "claimed.jsonl")
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", id: "claimed", cwd: process.cwd(), timestamp: new Date(0).toISOString() })}\n`,
  )
  if (record !== undefined) writeFileSync(`${claimed}.secret`, record)
  const transport = fakeHostTransport(answering, "win32")
  const served = join(dir, "pipe.sock")
  const server = createServer((socket) =>
    transport.authenticate(socket, () => {
      socket.setEncoding("utf8")
      let pending = ""
      socket.on("data", (chunk) => {
        pending += chunk
        for (let end: number; (end = pending.indexOf("\n")) >= 0;) {
          const frame = JSON.parse(pending.slice(0, end))
          pending = pending.slice(end + 1)
          const data =
            frame.type === "list_sessions"
              ? {
                  sessions: [
                    { sessionId: "rpc-1", durableSessionId: "answering", cwd: process.cwd(), activity: "running" },
                  ],
                }
              : { capabilities: ["session_row_hold"] }
          socket.write(
            `${JSON.stringify({ id: frame.id, type: "response", command: frame.type, success: true, data })}\n`,
          )
        }
      })
    }),
  )
  const store = createGatewayStore({ agentDir: dir })
  try {
    const listening = once(server, "listening")
    server.listen(served)
    await listening
    const host = createLiveThreadSurface(undefined, {
      platform: "win32",
      env: { HOME: dir, SENPI_RPC_SOCKET: answering },
      registry: async () => [],
      statusAll: async () => [
        { socket: answering, reachable: true, session_paths: [] },
        { socket: claimed, reachable: true, session_paths: [file] },
      ],
      connect: (path) => createConnection(path === transport.listenAddress ? served : path),
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
    if (!("threads" in result)) throw new Error("no rows")
    const row = (id: string) => result.threads.find((item: { thread: string }) => item.thread === id)
    expect(row("answering")).toMatchObject({ state: "running" })
    return { result, claimed, row: row("claimed") }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await store.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
}

test("#given a host whose pipe record is gone #when thread_list runs #then the thread it still claims lists inactive, the host is in neither count, and the listing is complete", async () => {
  const { result, claimed, row } = await listBesideClaimedHost(undefined)
  expect(result).toHaveProperty("host_counts", { answered: 1, unanswered: 0 })
  expect(result).not.toHaveProperty("listing")
  expect(row).toMatchObject({
    state: "inactive",
    liveness: { kind: "not_running" },
    error_note: `host_unavailable:${claimed}`,
  })
})

test("#given a host whose pipe record is there but not whole, as while the host writes it #when thread_list runs #then that host did not answer: its thread lists unknown, it counts as unanswered, and the listing is incomplete", async () => {
  const { result, row } = await listBesideClaimedHost(new Uint8Array(5))
  expect(result).toHaveProperty("host_counts", { answered: 1, unanswered: 1 })
  expect(result).toMatchObject({ listing: "incomplete" })
  expect(row).toMatchObject({ state: "unknown", liveness: { kind: "unknown", reason: "host_not_answering" } })
})
