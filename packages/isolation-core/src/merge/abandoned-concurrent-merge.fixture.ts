import { expect, test } from "bun:test"
import { startConcurrentMerges } from "./merge-fixture"

let abandoned: ReturnType<typeof startConcurrentMerges> | undefined

test("abandoned: fails while the first merge holds the lock and the second is queued", async () => {
  abandoned = startConcurrentMerges("branch")
  await abandoned.ready
  throw new Error("abandoned with both merges still owed")
})

test("neighbor: no git work from the abandoned test is still running", () => {
  expect(abandoned).toBeDefined()
  expect(abandoned?.settled()).toBe(true)
})
