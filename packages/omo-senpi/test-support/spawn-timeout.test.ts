import { expect, test } from "bun:test"
import { spawnTimeout } from "./spawn-timeout"

test.each([
  [1500.7, 1500],
  [1.9, 1],
  [1, 1],
])(
  "#given %p ms of budget left #when a spawn timeout is taken #then it is the whole-millisecond share %p",
  (remaining, expected) => {
    expect(spawnTimeout(remaining)).toBe(expected)
  },
)

test.each([[0.4], [0], [-5]])(
  "#given %p ms of budget left #when a spawn timeout is taken #then it refuses instead of returning the no-timeout value 0",
  (remaining) => {
    expect(() => spawnTimeout(remaining)).toThrow("the test budget is spent")
  },
)
