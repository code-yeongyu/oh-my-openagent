import { afterEach, describe, expect, test } from "bun:test"
import type { AliasRegistry } from "../../thread/remote/ports"
import { createLazyRemoteSurface } from "./lazy-remote"
import { createRemoteThreadFixture } from "../../thread/thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function lazySurface(loadAliasRegistry: () => Promise<AliasRegistry>) {
  const a = account()
  const remote = createLazyRemoteSurface({
    version: "0.0.0",
    sender: { kind: "session", id: "caller" },
    loadRuntime: async () => ({ remoteSessionsPort: () => a.remote.sessions, remoteClient: () => a.remote.client }),
    loadAliasRegistry,
  })
  return { a, remote }
}

describe("#12833: the default remote surface reaches the account's alias registry", () => {
  test("#given a signed-in CLI host #when thread_rename claims an alias for a thread here #then the registry holds it for that thread on this device, and the alias then addresses it", async () => {
    const registry = account().remote.aliases
    if (registry === undefined) throw new Error("the fixture account carries a registry")
    const { remote } = lazySurface(async () => registry)
    const { run } = surface(remote)
    expect(await run("thread_rename", { thread: "dur-local", alias: "build bot" })).toMatchObject({
      kind: "ok",
      alias: "build bot",
    })
    expect(await registry.resolve("build bot")).toEqual({
      kind: "ok",
      value: { session_id: "dur-local", device: "here" },
    })
    expect(await run("thread_send", { thread: "build bot", message: "hi" })).toMatchObject({
      kind: "ok",
      thread: "dur-local",
    })
  })

  test("#given the registry cannot be loaded yet #when an alias is claimed #then it is a typed host_unavailable with the load named, and the next claim loads it again", async () => {
    const registry = account().remote.aliases
    if (registry === undefined) throw new Error("the fixture account carries a registry")
    let loads = 0
    const { remote } = lazySurface(async () => {
      loads += 1
      if (loads === 1) throw new Error("not signed in yet")
      return registry
    })
    const { run } = surface(remote)
    expect(await run("thread_rename", { thread: "dur-local", alias: "later" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { reason: "registry_unavailable" } },
    })
    expect(await run("thread_rename", { thread: "dur-local", alias: "later" })).toMatchObject({
      kind: "ok",
      alias: "later",
    })
    expect(loads).toBe(2)
  })
})

describe("the default remote surface passes a one-device listing through", () => {
  test("#given a lazy surface #when sessions is asked for one device #then the loaded port answers that device's rows from a one-device read, never an account-wide round", async () => {
    const a = account()
    const remote = createLazyRemoteSurface({
      version: "0.0.0",
      sender: { kind: "session", id: "caller" },
      loadRuntime: async () => ({ remoteSessionsPort: () => a.remote.sessions, remoteClient: () => a.remote.client }),
    })
    const rows = await remote.sessions.sessions({ device: "b" })
    expect(rows.map((row) => row.device)).toEqual(["b"])
    expect(a.listings).toEqual({ all: 0, device: 1 })
  })
})

describe("the lazy surface forwards the lookup and wake path (omo#13037) to the loaded port", () => {
  test("#given a loaded port that can look up and wake #when the lazy surface is asked #then both capabilities and both calls reach the port", async () => {
    const a = account()
    const woken: string[] = []
    const remote = createLazyRemoteSurface({
      version: "0.0.0",
      sender: { kind: "session", id: "caller" },
      loadRuntime: async () => ({
        remoteSessionsPort: () => ({
          ...a.remote.sessions,
          canLookup: async () => true,
          lookup: async (_device, durableId) => ({ kind: "found", key: `key-of-${durableId}` }),
          canWake: async () => true,
          wake: async (device, durableId) => {
            woken.push(`${device}/${durableId}`)
            return { kind: "ok", response: {} }
          },
        }),
        remoteClient: () => a.remote.client,
      }),
    })
    expect(await remote.sessions.canLookup?.()).toBe(true)
    expect(await remote.sessions.lookup?.("b", "dur-gone")).toEqual({ kind: "found", key: "key-of-dur-gone" })
    expect(await remote.sessions.canWake?.()).toBe(true)
    expect(await remote.sessions.wake?.("b", "dur-gone", { type: "admit_external_message" })).toEqual({
      kind: "ok",
      response: {},
    })
    expect(woken).toEqual(["b/dur-gone"])
  })

  test("#given a loaded port without lookup or wake #when the lazy surface is asked #then it answers as an absent member does: no capability, unavailable", async () => {
    const a = account()
    const remote = createLazyRemoteSurface({
      version: "0.0.0",
      sender: { kind: "session", id: "caller" },
      loadRuntime: async () => ({ remoteSessionsPort: () => a.remote.sessions, remoteClient: () => a.remote.client }),
    })
    expect(await remote.sessions.canLookup?.()).toBe(false)
    expect(await remote.sessions.lookup?.("b", "dur-gone")).toEqual({ kind: "unavailable" })
    expect(await remote.sessions.canWake?.()).toBe(false)
    expect(await remote.sessions.wake?.("b", "dur-gone", {})).toEqual({ kind: "unavailable" })
  })
})

describe("the lazy remote client is a plain object to its callers", () => {
  test("#given the lazy client #when one of its member groups is awaited #then it settles at once (no then is forwarded), and members still reach the loaded client", async () => {
    const a = account()
    const remote = createLazyRemoteSurface({
      version: "0.0.0",
      sender: { kind: "session", id: "caller" },
      loadRuntime: async () => ({ remoteSessionsPort: () => a.remote.sessions, remoteClient: () => a.remote.client }),
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<"hung">((resolve) => {
      timer = setTimeout(() => resolve("hung"), 2_000)
    })
    const settled = await Promise.race([
      Promise.resolve(remote.client.devices).then(() => "settled" as const),
      deadline,
    ])
    clearTimeout(timer)
    expect(settled).toBe("settled")
    expect(await remote.client.devices.list()).toMatchObject({ kind: "ok" })
  })
})
