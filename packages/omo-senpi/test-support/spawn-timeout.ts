import { remainingTestTime } from "../../../test-support/test-deadline"

/**
 * A child-process kill timeout taken from the remaining test budget. `Bun.spawn`, `Bun.spawnSync` and node's spawnSync
 * treat `timeout: 0` as "no timeout", so a floored budget of 0 would leave a hung child running: once the budget is
 * spent this fails the test instead of spawning an unbounded child (#10814).
 */
export function spawnTimeout(remainingMs: number = remainingTestTime()): number {
  const ms = Math.floor(remainingMs)
  if (ms < 1) throw new Error(`the test budget is spent (${remainingMs} ms left); refusing to spawn a child without a kill timeout`)
  return ms
}
