import { afterAll, expect, test } from "bun:test"
import { DEFAULT_TEST_TIMEOUT_MS, remainingTestTime, resetTestDeadline } from "../../../../test-support/test-deadline"

const originalNow = performance.now
let now = 0
// The root preload restores Bun spies after each test; keep this clock until file teardown.
performance.now = () => now
afterAll(() => {
  performance.now = originalNow
  resetTestDeadline()
})

test("#given an earlier test #when its clock exhausts the launch budget #then no time remains", () => {
  now += DEFAULT_TEST_TIMEOUT_MS * 2
  expect(remainingTestTime()).toBe(0)
})

test("#given the next test #when its preload resets the stopwatch #then it has its own launch budget", () => {
  expect(remainingTestTime()).toBe(DEFAULT_TEST_TIMEOUT_MS * 0.9)
  expect(remainingTestTime(15_000)).toBe(13_500)
})
