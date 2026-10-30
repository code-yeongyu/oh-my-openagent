import { describe, expect, it } from "bun:test"
import { createLazyLiveThreadSurface } from "./lazy-live-surface"
import { createLiveThreadSurface } from "./live-surface"

describe("lazy live thread client", () => {
  it("keeps registration synchronous and shares one client across concurrent operations", async () => {
    let loads = 0
    const env = { OMO_RPC_SOCKET_PATH: "/tmp/thread-before.sock", OMO_CODING_AGENT_DIR: "/tmp/thread-lazy-home" }
    const host = createLazyLiveThreadSurface(undefined, {
      env, exists: () => false, registry: async () => [], statusAll: async () => [],
      loadRuntime: async () => { loads++; return { createLiveThreadSurface } },
    })
    expect(host.socket).toBe("/tmp/thread-before.sock")
    const endpoint = host.endpoint("/tmp/thread-endpoint.sock")
    expect(typeof endpoint.prompt).toBe("function")
    expect(typeof host.gateway.wake).toBe("function")
    expect(loads).toBe(0)
    env.OMO_RPC_SOCKET_PATH = "/tmp/thread-after.sock"
    const views = await Promise.all([host.listView({ offline: true }), host.listView({ offline: true })])
    expect(views.map(view => view.sessions)).toEqual([[], []])
    expect(host.socket).toBe("/tmp/thread-before.sock")
    expect(loads).toBe(1)
  })
  it("#given a failed runtime load #when concurrent callers then a later caller arrive #then the batch shares one load and the later call loads again", async () => {
    let loads = 0
    const host = createLazyLiveThreadSurface(undefined, {
      env: { OMO_RPC_SOCKET_PATH: "/tmp/thread-lazy.sock" },
      exists: () => false, registry: async () => [], statusAll: async () => [],
      loadRuntime: async () => { loads++; if (loads === 1) throw new Error("runtime unavailable"); return { createLiveThreadSurface } },
    })
    const results = await Promise.allSettled([host.listSessions(), host.listView()])
    expect(results.map(result => result.status)).toEqual(["rejected", "rejected"])
    expect(loads).toBe(1)
    const view = await host.listView({ offline: true })
    expect(view.sessions).toEqual([])
    expect(loads).toBe(2)
  })
  it("#given the runtime cannot load #when a thread operation runs #then it fails as host_unavailable for the registered socket, which the thread tools classify", async () => {
    const host = createLazyLiveThreadSurface(undefined, {
      env: { OMO_RPC_SOCKET_PATH: "/tmp/thread-lazy.sock" },
      loadRuntime: async () => { throw new Error("Cannot find module '#omo-thread-client-runtime'") },
    })
    const failed = await host.listSessions().then(() => undefined, (error: unknown) => error)
    expect(failed).toBeInstanceOf(Error)
    expect((failed as Error).message).toBe("host_unavailable:/tmp/thread-lazy.sock")
    expect((failed as Error).cause).toBeInstanceOf(Error)
  })
})
