/// <reference types="bun-types" />

// Guards the omowright version omo pins (root devDependency, staged into the browser skill): the
// BrowserSkill IPC client must re-adopt a live daemon whose daemon.json vanished instead of
// starting another one on the held port (#10216), and must cancel a call it gave up on so the
// session stays usable (#10217). A pin bump that regresses either fails here.
import { afterEach, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BskIpcClient } from "omowright"

type Frame = { readonly id: string; readonly method: string; readonly params?: Record<string, unknown> }
type Reply = Record<string, unknown> | undefined

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function fakeDaemonWithoutDaemonJson(handlers: Record<string, (frame: Frame) => Reply>) {
  const home = await mkdtemp(join(tmpdir(), "omo-bsk-home-"))
  await mkdir(join(home, "run"))
  const cancelled = Promise.withResolvers<Frame>()
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    let buffer = ""
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      let index = buffer.indexOf("\n")
      while (index !== -1) {
        const frame = JSON.parse(buffer.slice(0, index)) as Frame
        buffer = buffer.slice(index + 1)
        if (frame.method === "cancel") cancelled.resolve(frame)
        const reply = (handlers[frame.method] ?? (() => ({ result: { pong: true } })))(frame)
        if (reply !== undefined) socket.write(`${JSON.stringify({ id: frame.id, ...reply })}\n`)
        index = buffer.indexOf("\n")
      }
    })
  })
  // The daemon's default IPC endpoint is a Unix socket at $BSK_HOME/run/daemon.sock. Windows has no such socket: there the
  // daemon is reached over a named pipe passed as `sockPath` (omowright skills/omowright/references/browserskill.md).
  const sockPath = process.platform === "win32" ? `\\\\.\\pipe\\omo-bsk-test-${randomBytes(6).toString("hex")}` : join(home, "run", "daemon.sock")
  await new Promise<void>((resolve) => server.listen(sockPath, resolve))
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(home, { recursive: true, force: true })
  })
  return { home, sockPath, cancelled: cancelled.promise }
}

// Unix only by design, not a Windows gap in the test: omowright re-adopts an orphan daemon by probing the default Unix
// socket, and its probe returns false on win32 (src/bsk/ipc-client.js probeSocket: `process.platform === "win32"`),
// because Windows named pipes are not discovered automatically (skills/omowright/references/browserskill.md, "Remote
// browsers"). On Windows a caller passes `sockPath` instead, so there is no orphan-by-default-path case to re-adopt.
test.skipIf(process.platform === "win32")("a live BrowserSkill daemon without daemon.json is re-adopted, never restarted (#10216)", async () => {
  // Given a daemon still serving $BSK_HOME/run/daemon.sock after daemon.json disappeared
  const daemon = await fakeDaemonWithoutDaemonJson({})
  let starts = 0
  const client = new BskIpcClient({ home: daemon.home, autoStart: true, startDaemon: async () => void starts++ })

  // When the doctor or any call asks for it
  const result = await client.call("system.ping", {})

  // Then the live daemon answers and no second daemon is started on the held port
  expect(result).toEqual({ pong: true })
  expect(starts).toBe(0)
})

test("a call the client gives up on is cancelled at the daemon, so the session stays usable (#10217)", async () => {
  // Given an evaluate that never answers
  const daemon = await fakeDaemonWithoutDaemonJson({
    "tool.evaluate": () => undefined,
    cancel: () => ({ result: { cancelled: true } }),
  })
  const client = new BskIpcClient({ home: daemon.home, sockPath: daemon.sockPath, autoStart: false, timeoutMs: 150 })

  // When the client's wait runs out
  const handle = client.callWithHandle("tool.evaluate", { session_id: "s", expression: "new Promise(() => {})" })
  await expect(handle.promise).rejects.toMatchObject({ code: "timeout" })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("waited 2 s for the cancel frame, never sent")), 2_000)
  })
  const cancel = await Promise.race([daemon.cancelled, timedOut]).finally(() => clearTimeout(timer))

  // Then the daemon is told to stop that call
  expect(cancel.params).toEqual({ rpc_id: handle.rpcId })
})
