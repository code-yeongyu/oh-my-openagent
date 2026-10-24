import { expect, test } from "bun:test"
import { TaskConcurrency } from "./concurrency"

test("withdrawn admission keeps its lane and FIFO position when explicitly requeued", () => {
  const concurrency = new TaskConcurrency({ provider_concurrency: { test: 1 }, global_concurrency: 1 })
  const grants: string[] = []
  expect(concurrency.tryAcquire("test/model", "owner", 0)).toBe(true)
  concurrency.enqueue("test/model", "a", 3, () => grants.push("a"))
  concurrency.enqueue("test/other", "b", 4, () => grants.push("b"))
  const held = concurrency.withdraw("test/model", "a", 3)
  expect(held).toMatchObject({ model: "test/model", laneKey: "test", taskId: "a", runEpoch: 3 })
  if (held === undefined) throw new Error("queued admission was not withdrawn")
  expect(concurrency.queuePosition("test/model", "a")).toBeUndefined()
  concurrency.enqueue("test/model", "c", 5, () => grants.push("c"))
  concurrency.requeue(held, () => grants.push("a"))
  concurrency.releaseTask("owner")
  expect(grants).toEqual(["a"])
  concurrency.releaseTask("a")
  expect(grants).toEqual(["a", "b"])
  concurrency.releaseTask("b")
  expect(grants).toEqual(["a", "b", "c"])
})

test("a restarted allocator orders saved admissions without reconstructing parked tokens", () => {
  const prior = new TaskConcurrency({ default_concurrency: 1 })
  prior.tryAcquire("test/model", "old-owner", 0)
  prior.enqueue("test/model", "a", 3, () => { throw new Error("old admission must stay withdrawn") })
  prior.enqueue("test/model", "b", 4, () => { throw new Error("old admission must stay withdrawn") })
  const a = prior.withdraw("test/model", "a", 3)
  const b = prior.withdraw("test/model", "b", 4)
  if (a === undefined || b === undefined) throw new Error("missing admission metadata")
  const restarted = new TaskConcurrency({ default_concurrency: 1 })
  restarted.tryAcquire("test/model", "new-owner", 0)
  const grants: string[] = []
  restarted.requeue(b, () => grants.push("b"))
  restarted.requeue(a, () => grants.push("a"))
  restarted.releaseTask("new-owner")
  expect(grants).toEqual(["a"])
  expect(restarted.leaseState("a", 3)).toBe("held")
  restarted.releaseTask("a")
  expect(grants).toEqual(["a", "b"])
})

test("park and unpark retain the actual allocation sequence and provider lane", async () => {
  const concurrency = new TaskConcurrency({ provider_concurrency: { test: 1 } })
  concurrency.tryAcquire("test/model", "a", 3)
  const acquired = concurrency.admission("a", 3)
  expect(acquired).toMatchObject({ phase: "post_grant", laneKey: "test", model: "test/model" })
  const token = concurrency.park("a", 3)
  expect(concurrency.admission("a", 3)).toMatchObject({ ...acquired, phase: "parked" })
  await concurrency.unpark(token)
  expect(concurrency.admission("a", 3)).toEqual(acquired)
})
