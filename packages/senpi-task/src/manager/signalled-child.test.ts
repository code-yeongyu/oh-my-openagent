import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

import { describeChild, runSignalledChild } from "./__fixtures__/signalled-child"

const hangingChildPath = resolve(import.meta.dir, "__fixtures__", "hanging-child.ts")
const HANG_DEADLINE_MS = 1_500

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("runSignalledChild (#9890)", () => {
  test("#given a child that never signals READY #when the deadline passes #then it kills that child and names the phase", async () => {
    // given / when
    const result = await runSignalledChild([hangingChildPath], HANG_DEADLINE_MS)

    // then
    expect({ timedOut: result.timedOut, phase: result.phase }).toEqual({ timedOut: true, phase: "spawned" })
    expect(describeChild(result)).toContain('hit the hang deadline and was killed at phase "spawned"')
    expect(isAlive(result.pid)).toBe(false)
  })
})
