import { afterEach, expect, test } from "bun:test"
import { disposeSyncRpcFixtures, owner, setup } from "./sync-rpc-test-support"
import { AccountHttpError } from "../../../../memory-core/src/sync/account/http"
const deferred = <T>() => Promise.withResolvers<T>()
afterEach(disposeSyncRpcFixtures)

test("#given source resolution is held #when two enables race #then only one join opens", async () => {
  const f = await setup()
  const a = owner("a")
  f.hold()
  const first = f.call("enable", a.context)
  const second = f.call("enable", a.context)
  f.release()
  expect(await first).toMatchObject({ kind: "join_required", pairing: { pendingId: "p", code: null } })
  expect(await second).toEqual(await first)
  expect(f.counts().joins).toBe(1)
})

test("#given a live ceremony #when another owner reads or starts it #then state and authority stay private", async () => {
  const f = await setup()
  const a = owner("a")
  const b = owner("b")
  await f.call("enable", a.context)
  expect(await f.call("status", b.context)).toEqual({ sync: { state: "paused" }, enable: null, approvals: [] })
  expect(await f.call("enable", b.context, { ownerId: "a" })).toMatchObject({ kind: "refused" })
  expect(f.counts().joins).toBe(1)
})

test("#given an approval #when a foreign owner confirms #then its promise is not consumed", async () => {
  const f = await setup()
  const a = owner("a")
  const b = owner("b")
  await f.call("approve", a.context, { action: "begin", pendingId: "p" })
  await f.showApprovalCode()
  expect(await f.call("approve", b.context, { action: "confirm", pendingId: "p", code: "012345" })).toMatchObject({ kind: "refused" })
  expect(await f.call("approve", a.context, { action: "confirm", pendingId: "p", code: "012345" })).toMatchObject({ outcome: { kind: "approved", seq: 2 }, code: null })
  expect(f.counts().approvals).toBe(1)
})

test("#given a live approval #when its connection retires and a new connection reuses the same ownerId #then it cannot confirm the old approval", async () => {
  const f = await setup()
  const first = owner("a")
  await f.call("approve", first.context, { action: "begin", pendingId: "p" })
  await f.showApprovalCode()
  first.retire()
  const reconnect = owner("a")
  expect(await f.call("approve", reconnect.context, { action: "confirm", pendingId: "p", code: "012345" })).toMatchObject({ kind: "refused" })
  expect(await f.call("status", reconnect.context)).toMatchObject({ enable: null, approvals: [] })
  expect(f.counts().approvals).toBe(1)
})

test("#given a displayed code #when a different six digit code is submitted #then approval declines once", async () => {
  const f = await setup()
  const a = owner("a")
  await f.call("approve", a.context, { action: "begin", pendingId: "p" })
  await f.showApprovalCode()
  expect(await f.call("approve", a.context, { action: "confirm", pendingId: "p", code: "999999" })).toMatchObject({ outcome: { kind: "declined" }, code: null })
  expect(await f.call("approve", a.context, { action: "confirm", pendingId: "p", code: "012345" })).toMatchObject({ outcome: { kind: "declined" } })
  expect(f.counts().approvals).toBe(1)
})

test("#given source resolution is suspended #when the owner retires #then no operation port is opened", async () => {
  const f = await setup()
  const a = owner("a")
  f.hold()
  const pending = f.call("enable", a.context)
  a.retire()
  f.release()
  expect(await pending).toMatchObject({ kind: "refused" })
  expect(f.counts()).toEqual({ begins: 0, closes: 0, joins: 0, approvals: 0 })
})

test("#given approval waits for confirmation #when the account retires #then confirmation terminates and codes disappear", async () => {
  const f = await setup()
  const a = owner("a")
  await f.call("approve", a.context, { action: "begin", pendingId: "p" })
  await f.showApprovalCode()
  f.accountAbort.abort()
  expect(await f.call("status", a.context)).toMatchObject({ kind: "unavailable" })
  expect(await f.call("approve", a.context, { action: "confirm", pendingId: "p", code: "012345" })).toMatchObject({ kind: "refused" })
})

test("#given a terminal approval #when status is pulled repeatedly #then the outcome survives until another start", async () => {
  const f = await setup()
  const a = owner("a")
  await f.call("approve", a.context, { action: "begin", pendingId: "p" })
  await f.showApprovalCode()
  await f.call("approve", a.context, { action: "decline", pendingId: "p" })
  const expected = { sync: { state: "paused" }, enable: null, approvals: [{ pendingId: "p", expiresAt: expect.any(Number), code: null, outcome: { kind: "declined" } }] }
  expect(await f.call("status", a.context)).toEqual(expected)
  expect(await f.call("status", a.context)).toEqual(expected)
  expect(f.counts().closes).toBe(1)
})

test("#given an expired pending result #when status is read #then expiry remains recoverable", async () => {
  const f = await setup()
  const a = owner("a")
  f.runtime.joinAccount = async (input) => {
    input.onPending({ id: "p", expires_at: Date.now() - 1 })
    return { kind: "expired" }
  }
  expect(await f.call("enable", a.context)).toEqual({ kind: "expired" })
  expect(await f.call("status", a.context)).toMatchObject({ enable: { kind: "expired" } })
})

test("#given an operation begin held in the selected source #when pending owner disconnects #then listPending never dispatches", async () => {
  const f = await setup()
  const a = owner("a")
  const entered = deferred<void>()
  const release = deferred<void>()
  const original = f.account.forOperation
  let lists = 0
  f.account.forOperation = async (authority) => {
    const ports = await original(authority)
    entered.resolve()
    await release.promise
    return { ...ports, pairing: { ...ports.pairing, listPending: async () => { lists += 1; return [] } } }
  }
  const result = f.call("pending", a.context)
  await entered.promise
  a.retire()
  release.resolve()
  expect(await result).toMatchObject({ kind: "unavailable" })
  expect(lists).toBe(0)
  expect(f.counts().closes).toBe(1)
  expect(await f.call("pending", owner("b").context)).toEqual({ pending: [] })
})

test("#given public pending rows #when pending is read #then nonces and commitments never leave the handler", async () => {
  const f = await setup()
  const original = f.account.forOperation
  f.account.forOperation = async (authority) => {
    const ports = await original(authority)
    return { ...ports, pairing: { ...ports.pairing, listPending: async () => [{
      id: "p", account: "account", commitment: "private-commitment",
      answer: { principal: { kind: "device", id: "principal", signing_public_key: "public", sealing_public_key: "public" }, approver_nonce: "private-nonce" },
      reveal: null, expires_at: 10,
    }] } }
  }
  expect(await f.call("pending", owner("a").context)).toEqual({ pending: [{ id: "p", expiresAt: 10, answered: true, revealed: false }] })
  expect(f.counts()).toEqual({ begins: 1, closes: 1, joins: 0, approvals: 0 })
})

test("#given devices read fails #when devices is requested #then it is not an empty success or raw exception", async () => {
  const f = await setup()
  const original = f.account.forOperation
  f.account.forOperation = async (authority) => {
    const ports = await original(authority)
    return { ...ports, devices: async () => { throw new Error("secret service trace") } }
  }
  const result = await f.call("devices", owner("a").context)
  expect(result).toMatchObject({ kind: "unavailable" })
  expect(JSON.stringify(result)).not.toContain("secret service trace")
  expect(f.counts().closes).toBe(1)
})

test("#given a malformed device timestamp #when devices is requested #then schema rejection is unavailable", async () => {
  const f = await setup()
  const original = f.account.forOperation
  f.account.forOperation = async (authority) => {
    const ports = await original(authority)
    return { ...ports, devices: async () => [{
      id: "service-device", name: "device", kind: "cli", platform: "macos",
      createdAt: "invalid", lastSeenAt: "invalid", current: true, syncing: true,
      revokedAt: null, syncPrincipal: "different-principal",
    }] }
  }
  expect(await f.call("devices", owner("a").context)).toMatchObject({ kind: "unavailable" })
})

test("#given distinct service and sync IDs #when devices is requested #then original service fields are retained", async () => {
  const f = await setup()
  const original = f.account.forOperation
  const device = {
    id: "service-device", name: "device", kind: "cli" as const, platform: "macos" as const,
    createdAt: "2026-10-29T00:00:00Z", lastSeenAt: "2026-10-29T00:01:00Z", current: true, syncing: true,
    revokedAt: null, syncPrincipal: "different-principal",
  }
  f.account.forOperation = async (authority) => ({ ...await original(authority), devices: async () => [device] })
  expect(await f.call("devices", owner("a").context)).toEqual({ devices: [device] })
})

test("#given an old bound ceremony #when the engine binding changes #then codes cannot survive into the replacement", async () => {
  const f = await setup()
  const a = owner("a")
  await f.call("approve", a.context, { action: "begin", pendingId: "p" })
  await f.showApprovalCode()
  f.coordinator.retireBinding()
  expect(await f.call("status", a.context)).toEqual({ sync: { state: "paused" }, enable: null, approvals: [] })
  expect(await f.call("approve", a.context, { action: "confirm", pendingId: "p", code: "012345" })).toMatchObject({ kind: "refused" })
})

for (const field of ["principal", "signing", "sealing"] as const) {
  test(`#given the same service device but changed ${field} #when enable resolves its keyring #then no core effect starts`, async () => {
    const f = await setup()
    const original = f.account.forOperation
    let effects = 0
    f.runtime.enableSync = async () => { effects += 1; return { kind: "joined" } }
    f.account.forOperation = async (authority) => {
      const ports = await original(authority)
      return {
        ...ports,
        keyring: {
          ...ports.keyring,
          principal: () => ({ ...ports.keyring.principal(), ...(field === "principal" ? { id: "changed" } : {}) }),
          publicKeys: () => ({ ...ports.keyring.publicKeys(), ...(field === "principal" ? {} : { [field]: "changed" }) }),
        },
      }
    }
    expect(await f.call("enable", owner("a").context)).toMatchObject({ kind: "unavailable" })
    expect(effects).toBe(0)
    expect(f.counts().closes).toBe(1)
  })
}

for (const [status, kind] of [[403, "refused"], [503, "unavailable"]] as const) {
  test(`#given service status ${status} #when approval fails before its observer #then begin returns ${kind} without hanging`, async () => {
    const f = await setup()
    f.runtime.approveDevice = async () => { throw new AccountHttpError("private-detail", status) }
    const result = await f.call("approve", owner("a").context, { action: "begin", pendingId: "p" })
    expect(result).toMatchObject({ kind })
    expect(JSON.stringify(result)).not.toContain("private-detail")
    expect(f.counts().closes).toBe(1)
  })
}
