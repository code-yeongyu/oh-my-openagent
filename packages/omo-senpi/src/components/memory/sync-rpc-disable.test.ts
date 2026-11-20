import { afterEach, expect, test } from "bun:test"
import { AccountHttpError } from "../../../../memory-core/src/sync/account/http"
import { disposeSyncRpcFixtures, owner, setup } from "./sync-rpc-test-support"

afterEach(disposeSyncRpcFixtures)

/** A host whose sync runner counts how often it was told to stop the engines of a device that was turned off. */
async function host(overrides: Parameters<typeof setup>[0] = {}) {
  let stops = 0
  const resumed = Promise.withResolvers<void>()
  let resumes = 0
  const f = await setup({
    stopSync: async () => {
      stops += 1
    },
    resumeSync: async () => {
      resumes += 1
      resumed.resolve()
    },
    ...overrides,
  })
  return { ...f, stops: () => stops, resumes: () => resumes, resumed: resumed.promise }
}

test("#given sync on for this device #when disable is called #then this device is turned off through its own account, running engines are stopped and the answer is off", async () => {
  const f = await host()
  const turnedOff: unknown[] = []
  f.runtime.disableSync = async (input) => {
    turnedOff.push({ account: input.account, serviceDeviceId: input.serviceDeviceId, pinDir: input.pinDir })
    return { kind: "off" }
  }
  expect(await f.call("disable", owner("a").context)).toEqual({ kind: "off" })
  expect(turnedOff).toEqual([{ account: "account", serviceDeviceId: "service-device", pinDir: "/unused" }])
  expect(f.stops()).toBe(1)
  expect(f.counts()).toMatchObject({ begins: 1, closes: 1 })
})

test("#given a device already off #when disable is called again #then it answers off again", async () => {
  const f = await host()
  const a = owner("a")
  expect(await f.call("disable", a.context)).toEqual({ kind: "off" })
  expect(await f.call("disable", a.context)).toEqual({ kind: "off" })
  expect(f.stops()).toBe(2)
})

test("#given the service refuses to turn this device off #when disable is called #then the answer is a typed refusal without the service's words and no engine is stopped", async () => {
  const f = await host()
  f.runtime.disableSync = async () => ({ kind: "refused", code: "not_found" })
  const answer = await f.call("disable", owner("a").context)
  expect(answer).toEqual({ kind: "refused", reason: "The service did not turn memory sync off for this device." })
  expect(JSON.stringify(answer)).not.toContain("not_found")
  expect(f.stops()).toBe(0)
})

test("#given the service or the network fails #when disable is called #then the answer is a typed problem that never carries the error's text", async () => {
  const f = await host()
  f.runtime.disableSync = async () => {
    throw new AccountHttpError("unavailable", 503)
  }
  expect(await f.call("disable", owner("a").context)).toEqual({
    kind: "unavailable",
    reason: "Memory sync authority is unavailable.",
    code: "operation_failed",
  })
  f.runtime.disableSync = async () => {
    throw new TypeError("fetch failed: private-host.internal")
  }
  const answer = await f.call("disable", owner("a").context)
  expect(answer).toMatchObject({ kind: "unavailable", code: "operation_failed" })
  expect(JSON.stringify(answer)).not.toContain("private-host")
  expect(f.stops()).toBe(0)
})

test("#given a disable request that carries parameters #when it arrives #then it is refused before any account work", async () => {
  const f = await host()
  expect(await f.call("disable", owner("a").context, { device: "another-device" })).toEqual({
    kind: "refused",
    reason: "This request takes no parameters.",
  })
  expect(f.counts().begins).toBe(0)
  expect(f.stops()).toBe(0)
})

test("#given no signed-in account #when disable is called #then it answers unavailable with the no_account code", async () => {
  const f = await host({ source: async () => null })
  expect(await f.call("disable", owner("a").context)).toMatchObject({ kind: "unavailable", code: "no_account" })
  expect(f.stops()).toBe(0)
})

test("#given this engine #when features is asked #then disable is listed so the desktop can offer Turn off", async () => {
  const f = await host()
  const answer = (await f.call("features", owner("a").context)) as { readonly features: readonly string[] }
  expect(answer.features).toContain("disable")
})

test("#given a device that was turned off #when enable turns sync on again #then the engines this process parked are resumed", async () => {
  const f = await host()
  const a = owner("a")
  expect(await f.call("disable", a.context)).toEqual({ kind: "off" })
  f.runtime.enableSync = async () => ({ kind: "joined" })
  await f.call("enable", a.context)
  await f.resumed
  expect(f.resumes()).toBe(1)
})

test("#given enable does not end with sync on #when it settles #then nothing is resumed", async () => {
  const f = await host()
  f.runtime.enableSync = async () => ({ kind: "method_required", methods: ["passkey"] })
  expect(await f.call("enable", owner("a").context)).toMatchObject({ kind: "method_required" })
  expect(f.resumes()).toBe(0)
})
