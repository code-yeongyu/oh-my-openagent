import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { daemonReachable } from "./liveness"
import { FAKE_HOST_KEY_ROOT } from "./__fixtures__/fake-host-key-root"
import { fakeHostTransport } from "./__fixtures__/fake-host-transport"

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function socketDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-liveness-"))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// A daemon whose event loop is blocked: the kernel still completes the connect, nothing ever answers. It listens where
// the engine's transport dials: the socket path on POSIX, the named pipe derived from `<socket>.secret` on win32.
async function silentDaemon(socketPath: string): Promise<Server> {
  const connections: Socket[] = []
  const server = createServer((connection) => {
    connections.push(connection)
  })
  const { listenAddress } = fakeHostTransport(socketPath)
  await new Promise<void>((resolve) => server.listen(listenAddress, resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const connection of connections) connection.destroy()
        server.close(() => resolve())
      }),
  )
  return server
}

describe("daemonReachable (omo#9069)", () => {
  test("#given a daemon that accepts connections but never answers its probe #when the lifecycle asks #then it is reachable (busy), not gone", async () => {
    // given
    const socketPath = join(socketDir(), "rpc.sock")
    await silentDaemon(socketPath)

    // when
    const reachable = await daemonReachable(socketPath, FAKE_HOST_KEY_ROOT)

    // then
    expect(reachable).toBe(true)
  }, 30_000)

  test("#given a live daemon and no key root named #when the lifecycle asks #then it is reachable through the busy check, which sends nothing", async () => {
    // given: without a key root the engine probe is skipped, so only the transport connect can tell live from gone
    const socketPath = join(socketDir(), "rpc.sock")
    await silentDaemon(socketPath)

    // when
    const reachable = await daemonReachable(socketPath, undefined)

    // then
    expect(reachable).toBe(true)
  })

  test("#given no daemon behind the socket path #when the lifecycle asks #then it is unreachable", async () => {
    // given
    const socketPath = join(socketDir(), "rpc.sock")

    // when
    const reachable = await daemonReachable(socketPath, FAKE_HOST_KEY_ROOT)

    // then
    expect(reachable).toBe(false)
  })
})
