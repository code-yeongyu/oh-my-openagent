import { afterEach, describe, expect, test } from "bun:test"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { fakeHostTransport } from "../../../../senpi-task/src/runners/rpc-host/__fixtures__/fake-host-transport"
import { askHost } from "../../../../senpi-task/src/runners/rpc-host/host-request"
import { createLiveThreadSurface } from "./live-surface"

// Released senpi's own classifier (modes/rpc/host-client-occupancy.ts): the host decides idle exit by it, so the
// occupancy a client causes is pinned against the real class, not a copy of its rule.
type Occupancy = { admit(client: unknown): boolean; release(client: unknown): boolean }
const senpiDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const { ClientOccupancy } = (await import(pathToFileURL(join(senpiDist, "modes", "rpc", "host-client-occupancy.js")).href)) as {
  ClientOccupancy: new (onAttach: () => void) => Occupancy
}

type Classified = { readonly attachedAtLine: number | undefined; readonly frames: readonly Record<string, unknown>[] }

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function releasedHost(exercise: (socket: string, root: string) => Promise<unknown>): Promise<Classified> {
  const root = mkdtempSync(join(tmpdir(), "occupancy-"))
  roots.push(root)
  const socketPath = join(root, "rpc.sock")
  const transport = fakeHostTransport(socketPath)
  const frames: Record<string, unknown>[] = []
  let attachedAtLine: number | undefined
  const occupancy = new ClientOccupancy(() => { attachedAtLine ??= frames.length + 1 })
  const server = createServer((client) => transport.authenticate(client, () => {
    occupancy.admit(client)
    client.once("close", () => occupancy.release(client))
    let buffer = ""
    client.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const frame = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>
        buffer = buffer.slice(newline + 1)
        frames.push(frame)
        const data = frame.type === "get_protocol_info" ? { capabilities: [] }
          : frame.type === "list_sessions" ? { sessions: [] }
          : frame.type === "warm" ? { state: "warmed" } : {}
        client.write(`${JSON.stringify({ id: frame.id, type: "response", command: frame.type, success: true, data })}\n`)
      }
    })
  }))
  const listening = once(server, "listening", { signal: AbortSignal.timeout(2000) })
  server.listen(transport.listenAddress)
  await listening
  try {
    await exercise(socketPath, root)
  } finally {
    const closed = once(server, "close", { signal: AbortSignal.timeout(2000) })
    server.close()
    await closed
  }
  return { attachedAtLine, frames }
}

const surface = (socket: string, root: string) => createLiveThreadSurface(undefined, {
  env: { OMO_CODING_AGENT_DIR: root, SENPI_RPC_SOCKET: socket, SENPI_RPC_KEY_ROOT: root },
  statusAll: async () => undefined, registry: async () => [],
})

describe("occupancy on a released host (no attach_session, no socket_auth)", () => {
  test("#given a mutation #when it runs #then the connection attaches at the mutation, line 2, after the observing protocol probe", async () => {
    const { attachedAtLine, frames } = await releasedHost((socket, root) => surface(socket, root).setSessionName("rpc-1", "renamed", "dur-1"))
    expect(frames.map((frame) => [frame.type, frame.observe])).toEqual([["get_protocol_info", true], ["set_session_name", undefined]])
    expect(attachedAtLine).toBe(2)
  })

  test("#given a listing #when it runs #then the connection stays an observer", async () => {
    const { attachedAtLine, frames } = await releasedHost((socket, root) => surface(socket, root).listSessions())
    expect(frames.map((frame) => [frame.type, frame.observe])).toEqual([["get_protocol_info", true], ["list_sessions", true]])
    expect(attachedAtLine).toBeUndefined()
  })

  test("#given a task host warm #when askHost sends it #then the connection stays an observer", async () => {
    const { attachedAtLine, frames } = await releasedHost((socket, root) => askHost(socket, { type: "warm", id: "warm-occupancy", cwd: root, kind: "worker" }, 2000, { keyRoot: root }))
    // win32 authenticates by the pipe secret, so askHost sends no observing get_protocol_info probe first (host-request.ts,
    // pinned by host-request-auth.test.ts "raw pipe secret transport remains unchanged"); the warm itself is the same frame.
    const probe = process.platform === "win32" ? [] : [["get_protocol_info", true]]
    expect(frames.map((frame) => [frame.type, frame.observe])).toEqual([...probe, ["warm", undefined]])
    expect(attachedAtLine).toBeUndefined()
  })
})
