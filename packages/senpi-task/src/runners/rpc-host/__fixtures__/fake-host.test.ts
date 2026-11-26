import { describe, expect, test } from "bun:test"

import { startFakeHost } from "./fake-host"
import { connectFakeHost, fakeHostTransport } from "./fake-host-transport"

describe("fake host stop", () => {
  test("#given a connection still in its transport handshake #when the host stops #then stop ends it instead of waiting on its client (#14906)", async () => {
    // given: on win32 a connection is admitted only once its secret arrives; this transport never finishes that step,
    // the state a slow named-pipe dial is in when a suite's teardown stops the host
    const handshaking = Promise.withResolvers<void>()
    const host = await startFakeHost({
      transport: (socketPath) => ({ ...fakeHostTransport(socketPath), authenticate: () => handshaking.resolve() }),
    })
    const client = connectFakeHost(host.socketPath)
    client.on("error", () => undefined)
    const clientClosed = new Promise<void>((resolve) => client.once("close", () => resolve()))
    try {
      await handshaking.promise

      // when
      await host.stop()

      // then
      await clientClosed
      expect(client.destroyed).toBe(true)
    } finally {
      client.destroy()
    }
  })
})
