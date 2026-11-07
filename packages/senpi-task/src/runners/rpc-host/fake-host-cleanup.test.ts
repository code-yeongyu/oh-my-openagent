import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { once } from "node:events"
import * as net from "node:net"

import { startFakeHost } from "./__fixtures__/fake-host"
import * as transport from "./__fixtures__/fake-host-transport"

interface Listener {
  readonly server: net.Server
  readonly sockets: Set<net.Socket>
  readonly authenticate: Map<net.Socket, () => void>
}

const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore()
})

async function controlledHost() {
  // Hold authentication independently of acceptance so teardown runs between those two events.
  const listeners: Listener[] = []
  let authentication: Map<net.Socket, () => void>
  const transportSpy = spyOn(transport, "fakeHostTransport").mockImplementation((socketPath) => {
    authentication = new Map()
    const pending = authentication
    return { listenAddress: socketPath, authenticate: (socket, accept) => { pending.set(socket, accept) } }
  })
  const serverSpy = spyOn(net, "createServer").mockImplementation((...args) => {
    const server = Reflect.construct(net.Server, args) as net.Server
    const sockets = new Set<net.Socket>()
    const closes: Array<() => void> = []
    const drain = () => {
      if (sockets.size === 0) for (const close of closes.splice(0)) close()
    }
    const listenSpy = spyOn(server, "listen").mockImplementation((...listenArgs: unknown[]) => {
      const ready = listenArgs.at(-1)
      if (typeof ready === "function") queueMicrotask(() => ready())
      return server
    })
    const closeSpy = spyOn(server, "close").mockImplementation((closed) => {
      if (closed !== undefined) closes.push(() => closed())
      drain()
      return server
    })
    server.on("connection", (socket: net.Socket) => {
      sockets.add(socket)
      socket.once("close", () => { sockets.delete(socket); drain() })
    })
    listeners.push({ server, sockets, authenticate: authentication })
    restores.push(() => listenSpy.mockRestore(), () => closeSpy.mockRestore())
    return server
  })
  restores.push(() => transportSpy.mockRestore(), () => serverSpy.mockRestore())
  const host = await startFakeHost()
  const accepted: net.Socket[] = []
  const connect = (listener: Listener) => {
    const socket = new net.Socket()
    accepted.push(socket)
    const closed = once(socket, "close", { signal: AbortSignal.timeout(5_000) })
    listener.server.emit("connection", socket)
    return { socket, closed, authenticate: () => listener.authenticate.get(socket)?.() }
  }
  return {
    host, listeners, connect,
    cleanup: async () => {
      for (const socket of accepted) socket.destroy()
      await host.stop()
    },
  }
}

describe("fake host accepted-socket cleanup", () => {
  test.each(["stop", "crash"] as const)("#given an accepted socket awaiting authentication #when %s retires the host #then it closes without an authentication deadline or late admission", async (action) => {
    // given
    const world = await controlledHost()
    const peer = world.connect(world.listeners[0]!)
    try {
      expect(world.host.connections).toBe(0)

      // when
      const stopped = world.host[action]()
      expect(peer.socket.destroyed).toBe(true)
      peer.authenticate()
      peer.socket.emit("data", '{"id":"late","type":"get_protocol_info"}\n')

      // then
      expect(world.host.connections).toBe(0)
      expect(world.host.commands).toEqual([])
      await peer.closed
      await stopped
    } finally {
      await world.cleanup()
    }
  })

  test.each(["restart", "crash then restart"] as const)("#given authenticated and pending sockets #when %s replaces the listener #then the retired generation cannot admit late sockets or close the new one", async (action) => {
    // given
    const world = await controlledHost()
    const first = world.listeners[0]!
    const live = world.connect(first)
    live.authenticate()
    const pending = world.connect(first)
    try {
      expect(world.host.connections).toBe(1)

      // when
      if (action === "crash then restart") world.host.crash()
      const restarted = world.host.restart()
      expect(live.socket.destroyed).toBe(true)
      expect(pending.socket.destroyed).toBe(true)
      await Promise.all([live.closed, pending.closed, restarted])
      const current = world.connect(world.listeners[1]!)
      current.authenticate()
      pending.authenticate()
      const late = world.connect(first)
      late.authenticate()

      // then
      expect(late.socket.destroyed).toBe(true)
      expect(current.socket.destroyed).toBe(false)
      expect(world.host.connections).toBe(1)
      const stopped = world.host.stop()
      await Promise.all([current.closed, late.closed, stopped])
      expect(world.host.connections).toBe(0)
    } finally {
      await world.cleanup()
    }
  })
})
