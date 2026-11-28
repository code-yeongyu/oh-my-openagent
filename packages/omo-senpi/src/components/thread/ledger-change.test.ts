import { afterEach, expect, test } from "bun:test"

import { createGatewayHarness, type GatewayHarness } from "./gateway/testing/harness"
import { answerLedgerRequest, applyLedgerChange } from "./ledger-change"

// Row 25 of #15221 (slice B): a hand-over is recorded on the old opener's device, the new opener's and the child's,
// each applying the same change to its own store.

const harnesses: GatewayHarness[] = []
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()))
})
const device = () => {
  const h = createGatewayHarness()
  harnesses.push(h)
  return h.store()
}

const handOver = { op: "hand_over", created: "child", from: "lead", to: "heir", to_device: "dev-c" } as const

test("#given the opener's, the new opener's and the child's stores #when each applies the hand-over #then all three name the new opener", async () => {
  const [openerDevice, heirDevice, childDevice] = [device(), device(), device()]
  for (const store of [openerDevice, childDevice])
    await store.recordThreadCreation({ creator_durable_id: "lead", created_durable_id: "child", creator_device: "dev-a" })
  for (const store of [openerDevice, heirDevice, childDevice]) {
    expect(await applyLedgerChange(store, handOver)).toEqual({ kind: "ok" })
    expect(await store.threadOpener("child")).toMatchObject({ creator_durable_id: "heir", creator_device: "dev-c" })
  }
  expect(await openerDevice.threadChildren("lead")).toEqual([])
  expect(await heirDevice.threadChildren("heir")).toEqual([expect.objectContaining({ created_durable_id: "child" })])
})

test("#given a hand-over already applied #when the same request arrives again #then it answers ok and changes nothing", async () => {
  const store = device()
  await store.recordThreadCreation({ creator_durable_id: "lead", created_durable_id: "child" })
  await applyLedgerChange(store, handOver)
  expect(await applyLedgerChange(store, handOver)).toEqual({ kind: "ok" })
  expect(await store.threadOpener("child")).toMatchObject({ creator_durable_id: "heir" })
})

test("#given a store whose row names another opener #when a hand-over from lead arrives #then it is refused not_creator and the row stays", async () => {
  const store = device()
  await store.recordThreadCreation({ creator_durable_id: "other", created_durable_id: "child" })
  expect(await applyLedgerChange(store, handOver)).toMatchObject({ kind: "refused", code: "not_creator" })
  expect(await store.threadOpener("child")).toMatchObject({ creator_durable_id: "other" })
})

test("#given metadata over 4 KB #when it is set through a ledger request #then it is refused metadata_too_large and nothing is stored", async () => {
  const store = device()
  const answer = await answerLedgerRequest(store, { op: "set_metadata", thread: "child", value: "x".repeat(4096) })
  expect(answer).toMatchObject({ kind: "refused", code: "metadata_too_large", limit: 4096 })
  expect(await store.threadMetadata("child")).toBeUndefined()
})

test("#given a request that is no hand_over or set_metadata #when it arrives #then it is refused invalid_arguments", async () => {
  expect(await answerLedgerRequest(device(), { op: "drop_table" })).toMatchObject({
    kind: "refused",
    code: "invalid_arguments",
  })
})
