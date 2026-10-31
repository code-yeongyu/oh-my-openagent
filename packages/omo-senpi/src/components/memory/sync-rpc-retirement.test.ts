import { afterEach, expect, test } from "bun:test"
import { disposeSyncRpcFixtures, owner, setup } from "./sync-rpc-test-support"

afterEach(disposeSyncRpcFixtures)

test("#given a held selected-account boundary #when the transport gate retires without notification #then its dispatch never runs", async () => {
  const f = await setup()
  const a = owner("a")
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let effects = 0
  f.account.boundary = async (dispatch) => { entered.resolve(); await release.promise; return dispatch() }
  f.runtime.enableSync = async (input) => {
    await input.authority.boundary(() => { effects += 1 })
    return { kind: "joined" }
  }
  const result = f.call("enable", a.context)
  await entered.promise
  a.retireGate()
  release.resolve()
  expect(await result).toMatchObject({ kind: "unavailable" })
  expect(effects).toBe(0)
})

test("#given delayed account-retirement notification #when the owner repeats enable #then old progress is refused", async () => {
  const f = await setup()
  const a = owner("a")
  await f.call("enable", a.context)
  f.account.isCurrent = async () => false
  expect(await f.call("enable", a.context)).toMatchObject({ kind: "refused" })
})

test("#given delayed account-retirement notification #when the owner repeats approval begin #then the old code is not returned", async () => {
  const f = await setup()
  const a = owner("a")
  await f.call("approve", a.context, { action: "begin", pendingId: "p" })
  await f.showApprovalCode()
  f.account.isCurrent = async () => false
  const result = await f.call("approve", a.context, { action: "begin", pendingId: "p" })
  expect(result).toMatchObject({ kind: "refused" })
  expect(JSON.stringify(result)).not.toContain("012345")
})

test("#given concurrent approval starts before source resolution #when the source resumes #then one answer is sent", async () => {
  const f = await setup()
  const a = owner("a")
  f.hold()
  const first = f.call("approve", a.context, { action: "begin", pendingId: "p" })
  const second = f.call("approve", a.context, { action: "begin", pendingId: "p" })
  f.release()
  expect(await second).toEqual(await first)
  expect(f.counts().approvals).toBe(1)
})
