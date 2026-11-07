import { expect, test } from "bun:test"
import { withCompletionDeadline } from "./completion-deadline"

test("#given the SDK promise settled #when parent abort arrives before the await continuation #then the resolved value is not handed to its consumer", async () => {
  // given
  const parent = new AbortController()
  let signal: AbortSignal | undefined
  const result = withCompletionDeadline(parent.signal, async (operationSignal) => {
    signal = operationSignal
    return "completed snapshot"
  })
  // when
  queueMicrotask(() => parent.abort())
  // then
  await expect(result).rejects.toThrow("Task aborted.")
  expect(signal?.aborted).toBe(true)
})
