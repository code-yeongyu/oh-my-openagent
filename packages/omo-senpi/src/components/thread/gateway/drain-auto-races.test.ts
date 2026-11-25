import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"

import { createInboxDrain } from "./drain"
import { FakeSessionRuntime } from "./testing/fake-runtime"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { GatewayDeliveryResult } from "./types"

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function okId(result: GatewayDeliveryResult): string {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result.delivery_id
}

test("#given an auto delivery decided as a steer into turn N #when the turn moves to N+1 before it is admitted #then it is decided again and steered into the live turn, never refused", async () => {
  // given
  const h = (harness = createGatewayHarness())
  h.session("A")
  h.phantom("B")
  const runtime = new FakeSessionRuntime(join(h.agentDir, "sessions", "B.jsonl"), "B", h.agentDir)
  runtime.beginUserTurn()
  const id = okId(
    await h.get("A").engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: "B", text: "auto" }),
  )
  const store = h.store()
  const drain = createInboxDrain({
    store,
    runtime,
    durableId: "B",
    sessionPath: () => runtime.sessionPath,
    now: () => h.clock.now,
    _test: { afterClaim: () => runtime.beginUserTurn() },
  })

  // when
  const result = await drain.drain({ reason: "start" })

  // then
  expect(result.admitted).toEqual([{ delivery_id: id, kind: "steered" }])
  expect((await store.deliveryView(id))?.row.state).toBe("admitted")
  expect(runtime.enqueueCalls).toEqual([{ lane: "steer", delivery_id: id }])
})

test("#given an auto delivery decided as a start for an idle session #when a run begins before it is admitted #then it is steered into that run, not left as a follow-up for a second run", async () => {
  // given
  const h = (harness = createGatewayHarness())
  h.session("A")
  h.phantom("B")
  const runtime = new FakeSessionRuntime(join(h.agentDir, "sessions", "B.jsonl"), "B", h.agentDir)
  const id = okId(
    await h.get("A").engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: "B", text: "auto" }),
  )
  const drain = createInboxDrain({
    store: h.store(),
    runtime,
    durableId: "B",
    sessionPath: () => runtime.sessionPath,
    now: () => h.clock.now,
    _test: { afterClaim: () => runtime.beginUserTurn() },
  })

  // when
  const result = await drain.drain({ reason: "start" })

  // then
  expect(result.admitted).toEqual([{ delivery_id: id, kind: "steered" }])
  expect(runtime.enqueueCalls).toEqual([{ lane: "steer", delivery_id: id }])
})
