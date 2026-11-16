import { afterEach, describe, expect, test } from "bun:test"
import { closeClients, startOwner } from "../testing/fake-service"
import * as runtime from "./thread-runtime"
import { createLazyRemoteSurface } from "./lazy-remote"

// The engine's thread surface reads the account through its client and runs commands through its port (#13768 L3). Both
// must ride ONE device-service connection: the port borrows the client's shared one, and the client's close() ends it.

const ENV = "OMO_DEVICE_SERVICE_STATE_DIR"
const before = process.env[ENV]
afterEach(closeClients)
afterEach(() => {
  if (before === undefined) delete process.env[ENV]
  else process.env[ENV] = before
})

describe("the engine's thread surface holds one device-service connection", () => {
  test("#given the lazy surface over the thread runtime #when the client reads the account and the port lists sessions #then the device service accepted one connection", async () => {
    const owner = await startOwner()
    process.env[ENV] = owner.stateDir
    const remote = createLazyRemoteSurface({
      version: "0.0.0-test",
      sender: { kind: "session", id: "engine-1" },
      loadRuntime: async () => runtime,
    })
    try {
      expect((await remote.client.devices.list()).kind).toBe("ok")
      await remote.sessions.sessions()
      expect(owner.connections()).toBe(1)
    } finally {
      remote.client.close()
    }
  })
})
