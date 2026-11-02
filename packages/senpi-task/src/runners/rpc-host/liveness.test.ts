import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { daemonReachable } from "./liveness"

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function socketDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-liveness-"))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// A daemon whose event loop is blocked: the kernel still completes the connect, nothing ever answers.
async function silentDaemon(socketPath: string): Promise<Server> {
  const connections: Socket[] = []
  const server = createServer((connection) => {
    connections.push(connection)
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const connection of connections) connection.destroy()
        server.close(() => resolve())
      }),
  )
  return server
}

describe.skipIf(process.platform === "win32")("daemonReachable (omo#9069)", () => {
  test("#given a daemon that accepts connections but never answers its probe #when the lifecycle asks #then it is reachable (busy), not gone", async () => {
    // given
    const socketPath = join(socketDir(), "rpc.sock")
    await silentDaemon(socketPath)

    // when
    const reachable = await daemonReachable(socketPath)

    // then
    expect(reachable).toBe(true)
  }, 30_000)

  test("#given no daemon behind the socket path #when the lifecycle asks #then it is unreachable", async () => {
    // given
    const socketPath = join(socketDir(), "rpc.sock")

    // when
    const reachable = await daemonReachable(socketPath)

    // then
    expect(reachable).toBe(false)
  })
})
