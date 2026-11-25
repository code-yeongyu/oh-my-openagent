import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"

import type { AdmitExternalMessageInput } from "./adapter"
import { createInboxDrain } from "./drain"
import { FakeSessionRuntime } from "./testing/fake-runtime"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { DeliveryRow, GatewayDeliveryResult } from "./types"

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function okId(result: GatewayDeliveryResult): string {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result.delivery_id
}

/** The target answers `turn_conflict` to its first `conflicts` admissions, as an engine whose turn moved would. */
class ConflictingRuntime extends FakeSessionRuntime {
  conflicts = 0
  constructor(sessionPath: string, agentDir: string) {
    super(sessionPath, "B", agentDir)
    const admitAsFake = this.admitExternalMessage
    this.admitExternalMessage = (input: AdmitExternalMessageInput) => {
      if (this.conflicts === 0) return admitAsFake(input)
      this.conflicts -= 1
      return { kind: "turn_conflict", turn_epoch: this.epoch }
    }
  }
}

function world<R extends FakeSessionRuntime = FakeSessionRuntime>(
  make: (sessionPath: string, agentDir: string) => R = (path, dir) => new FakeSessionRuntime(path, "B", dir) as R,
) {
  const h = (harness = createGatewayHarness())
  h.session("A")
  h.phantom("B")
  const target = make(join(h.agentDir, "sessions", "B.jsonl"), h.agentDir)
  const store = h.store()
  const send = async (
    text: string,
    options: { readonly mode?: "follow_up" | "steer"; readonly expected_turn_id?: number } = {},
  ) =>
    okId(
      await h.get("A").engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: "B", text, ...options }),
    )
  const drainWith = (afterClaim?: (row: DeliveryRow) => void) =>
    createInboxDrain({
      store,
      runtime: target,
      durableId: "B",
      sessionPath: () => target.sessionPath,
      now: () => h.clock.now,
      ...(afterClaim === undefined ? {} : { _test: { afterClaim } }),
    })
  const row = async (id: string) => (await store.deliveryView(id))?.row
  return { target, send, drainWith, row }
}

test("#given an auto delivery decided as a steer into turn N #when the turn moves to N+1 before its admission #then it is steered into the live turn, never refused", async () => {
  // given
  const { target, send, drainWith, row } = world()
  target.beginUserTurn()
  const id = await send("auto")

  // when
  const result = await drainWith(() => target.beginUserTurn()).drain({ reason: "start" })

  // then
  expect(result.admitted).toEqual([{ delivery_id: id, kind: "steered" }])
  expect(target.enqueueCalls).toEqual([{ lane: "steer", delivery_id: id }])
  expect((await row(id))?.mode_effective).toBe("steer")
})

test("#given an auto delivery decided as a start #when a run begins before its admission #then it is steered into that run and its row records the steer lane", async () => {
  // given
  const { target, send, drainWith, row } = world()
  const id = await send("auto")

  // when
  const result = await drainWith(() => target.beginUserTurn()).drain({ reason: "start" })

  // then
  expect(result.admitted).toEqual([{ delivery_id: id, kind: "steered" }])
  expect(target.enqueueCalls).toEqual([{ lane: "steer", delivery_id: id }])
  expect((await row(id))?.mode_effective).toBe("steer")
})

test("#given an explicit follow-up decided as a start #when a run begins before its admission #then it still queues behind that run", async () => {
  // given
  const { target, send, drainWith, row } = world()
  const id = await send("later", { mode: "follow_up" })

  // when
  const result = await drainWith(() => target.beginUserTurn()).drain({ reason: "start" })

  // then
  expect(result.admitted).toEqual([{ delivery_id: id, kind: "queued" }])
  expect(target.enqueueCalls).toEqual([{ lane: "followUp", delivery_id: id }])
  expect((await row(id))?.mode_effective).toBe("follow_up")
})

test("#given an auto delivery decided as a start #when the session starts waiting on a question before its admission #then it queues as an approval wait, never steered into the question", async () => {
  // given
  const { target, send, drainWith, row } = world()
  const id = await send("auto")

  // when
  const result = await drainWith(() => {
    target.phaseValue = "waiting_question"
  }).drain({ reason: "start" })

  // then
  expect(result.admitted).toEqual([{ delivery_id: id, kind: "queued" }])
  expect((await row(id))?.wait_kind).toBe("approval")
})

test("#given three auto deliveries to an idle session #when a run begins while the pass claims the second #then all three are steered into that run in seq order", async () => {
  // given
  const { target, send, drainWith } = world()
  const ids = [await send("one"), await send("two"), await send("three")]
  let claims = 0

  // when
  const result = await drainWith(() => {
    claims += 1
    if (claims === 2) target.beginUserTurn()
  }).drain({ reason: "start" })

  // then
  expect(result.admitted.map((entry) => entry.kind)).toEqual(["steered", "steered", "steered"])
  expect(target.enqueueCalls).toEqual(ids.map((delivery_id) => ({ lane: "steer", delivery_id })))
})

test("#given a held start and a joining delivery #when the session starts compacting before they are admitted #then both queue and neither is reported as steered", async () => {
  // given
  const { target, send, drainWith } = world()
  const ids = [await send("one"), await send("two")]
  let claims = 0

  // when
  const result = await drainWith(() => {
    claims += 1
    if (claims === 2) target.phaseValue = "compacting"
  }).drain({ reason: "start" })

  // then
  expect(result.admitted).toEqual(ids.map((delivery_id) => ({ delivery_id, kind: "queued" })))
})

test("#given an auto delivery the engine answers turn_conflict #when the pass ends #then it is queued again exactly once and the next pass admits it exactly once", async () => {
  // given
  const { target, send, drainWith, row } = world((path, dir) => new ConflictingRuntime(path, dir))
  target.conflicts = 1
  const id = await send("auto")
  const drain = drainWith()

  // when
  const first = await drain.drain({ reason: "start" })
  const between = await row(id)
  const second = await drain.drain({ reason: "inbox" })

  // then
  expect(first.admitted).toEqual([])
  expect(between?.state).toBe("queued")
  expect(second.admitted).toEqual([{ delivery_id: id, kind: "started" }])
  expect(target.enqueueCount(id)).toBe(1)
})

test("#given an explicit-mode delivery the engine answers turn_conflict #when the pass ends #then it is refused turn_conflict, not queued again like an auto one", async () => {
  // given
  const { target, send, drainWith, row } = world((path, dir) => new ConflictingRuntime(path, dir))
  target.conflicts = 1
  const id = await send("later", { mode: "follow_up" })

  // when
  const result = await drainWith().drain({ reason: "inbox" })

  // then
  expect(result.admitted).toEqual([{ delivery_id: id, kind: "turn_conflict" }])
  expect((await row(id))?.state).toBe("refused")
})
