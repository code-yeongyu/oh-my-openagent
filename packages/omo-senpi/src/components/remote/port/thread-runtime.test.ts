import { afterEach, describe, expect, test } from "bun:test"
import { closeClients, startOwner } from "../testing/fake-service"
import { connectionOf } from "../connection-of"
import * as runtime from "./thread-runtime"
import { createLazyRemoteSurface } from "./lazy-remote"
import { PEER } from "../../../../../device-service-core/test/local-api/conformance/world.ts"

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

  test("#given the same surface #when an endpoint command (open_session) runs #then it rides a fresh connection of its own, and the shared one keeps serving the client (#12777)", async () => {
    const owner = await startOwner()
    process.env[ENV] = owner.stateDir
    const remote = createLazyRemoteSurface({
      version: "0.0.0-test",
      sender: { kind: "session", id: "engine-1" },
      loadRuntime: async () => runtime,
    })
    try {
      expect((await remote.client.devices.list()).kind).toBe("ok")
      await remote.sessions.endpointCommand(PEER, { type: "open_session" })
      expect(owner.connections()).toBe(2)
      expect((await remote.client.devices.list()).kind).toBe("ok")
      expect(owner.connections()).toBe(2)
    } finally {
      remote.client.close()
    }
  })

  test("#given a port factory that throws once #when the surface is used twice #then the failure is not kept and the second call loads (#13944 L1)", async () => {
    const owner = await startOwner()
    process.env[ENV] = owner.stateDir
    let calls = 0
    const remote = createLazyRemoteSurface({
      version: "0.0.0-test",
      sender: { kind: "session", id: "engine-1" },
      loadRuntime: async () => ({
        ...runtime,
        remoteSessionsPort: (version, client) => {
          calls += 1
          if (calls === 1) throw new Error("port factory failed")
          return runtime.remoteSessionsPort(version, client)
        },
      }),
    })
    try {
      await expect(remote.sessions.sessions()).rejects.toThrow("port factory failed")
      expect(Array.isArray(await remote.sessions.sessions())).toBe(true)
    } finally {
      remote.client.close()
    }
  })

  test("#given a closed client #when its connection is asked for #then nothing is opened again (#13944 L2)", async () => {
    const owner = await startOwner()
    process.env[ENV] = owner.stateDir
    const client = runtime.remoteClient("0.0.0-test", { kind: "session", id: "engine-1" })
    client.close()
    await expect(connectionOf(client)).rejects.toThrow("closed")
    expect(owner.connections()).toBe(0)
  })

  test("#given a person sender for another uid #when its client is built #then it is refused, never built for this process's user (#13944 L4)", () => {
    expect(() => runtime.remoteClient("0.0.0-test", { kind: "person", uid: "not-this-user" })).toThrow()
  })
})
