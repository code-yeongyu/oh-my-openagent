// #12303 review LOW: the desktop/RPC enable result carries the ceremony's `rootChanged`, so the
// desktop can show "your memory history changed" as the CLI does. The field is additive: the
// desktop's Effect structs ignore it until they declare it.

import { afterEach, expect, test } from "bun:test"

import { disposeSyncRpcFixtures, owner, setup } from "./sync-rpc-test-support"

afterEach(disposeSyncRpcFixtures)

test("#given a first-device genesis that replaced a retired root #when enable completes #then the result says the root changed", async () => {
  const f = await setup()
  f.runtime.enableSync = async () => ({ kind: "joined", created: true, rootChanged: true })
  expect(await f.call("enable", owner("a").context)).toEqual({ kind: "first_device_created", rootChanged: true })
})

test("#given a pairing join into a root other than the retired one #when enable completes #then the result says the root changed", async () => {
  const f = await setup()
  f.runtime.joinAccount = async (input) => {
    input.onPending({ id: "p", expires_at: Date.now() + 60_000 })
    return { kind: "joined", rootChanged: true }
  }
  const a = owner("a")
  expect(await f.call("enable", a.context)).toEqual({ kind: "joined", rootChanged: true })
  expect(await f.call("status", a.context)).toMatchObject({ enable: { kind: "joined", rootChanged: true } })
})

// #12382 review L1: a ceremony that pinned but could not read the retired pins does not know whether the root changed.
// The desktop must see that (an additive optional field), and the in-process warning goes to the component logger.
test("#given a first-device genesis whose root-change check was skipped #when enable completes #then the result says so and the logger is told", async () => {
  const warnings: { message: string; fields: Record<string, unknown> }[] = []
  const f = await setup({ warn: (message, fields) => warnings.push({ message, fields }) })
  f.runtime.enableSync = async () => ({
    kind: "joined",
    created: true,
    rootCheck: { kind: "skipped", reason: "EACCES" },
  })
  expect(await f.call("enable", owner("a").context)).toEqual({
    kind: "first_device_created",
    rootCheck: { kind: "skipped", reason: "EACCES" },
  })
  expect(warnings.map((warning) => warning.fields)).toEqual([{ path: "enable", code: "EACCES" }])
})

test("#given a pairing join whose root-change check was skipped #when enable completes #then the result and status say so and the logger is told", async () => {
  const warnings: { message: string; fields: Record<string, unknown> }[] = []
  const f = await setup({ warn: (message, fields) => warnings.push({ message, fields }) })
  f.runtime.joinAccount = async (input) => {
    input.onPending({ id: "p", expires_at: Date.now() + 60_000 })
    return { kind: "joined", rootCheck: { kind: "skipped", reason: "EIO" } }
  }
  const a = owner("a")
  expect(await f.call("enable", a.context)).toEqual({ kind: "joined", rootCheck: { kind: "skipped", reason: "EIO" } })
  expect(await f.call("status", a.context)).toMatchObject({
    enable: { kind: "joined", rootCheck: { kind: "skipped", reason: "EIO" } },
  })
  expect(warnings.map((warning) => warning.fields)).toEqual([{ path: "enable", code: "EIO" }])
})

test("#given an ordinary join #when enable completes #then no root-change field appears", async () => {
  const f = await setup()
  f.runtime.enableSync = async () => ({ kind: "joined" })
  expect(await f.call("enable", owner("a").context)).toEqual({ kind: "joined" })
})
