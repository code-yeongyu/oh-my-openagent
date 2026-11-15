import { afterEach, describe, expect, test } from "bun:test"
import type { AliasRegistry } from "./ports"
import { createLazyRemoteSurface } from "./lazy-remote"
import { createRemoteThreadFixture } from "../thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function lazySurface(loadAliasRegistry: () => Promise<AliasRegistry>) {
  const a = account()
  const remote = createLazyRemoteSurface({
    version: "0.0.0",
    loadRuntime: async () => ({ createDeviceServiceSessions: () => a.remote.sessions }),
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
      thread_id: "dur-local",
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
