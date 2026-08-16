import { describe, expect, test } from "bun:test"

import { createTaskId, syncTaskIdFloor } from "./id"

/**
 * Pins the per-test reset the root test-setup performs via
 * _resetTaskIdFloorForTesting. Without it, the first test's poison survives
 * into the second one and every clock-derived id assertion in the process
 * (manager-claim characterization among them) starts failing depending on
 * which fixture-heavy file happened to run earlier.
 */
describe("task id floor test isolation", () => {
  test("#given a fixture-scale id #when the floor is raised inside one test #then allocation follows the poisoned floor", () => {
    // given
    syncTaskIdFloor("st_deadbeef")

    // when
    const id = createTaskId(0x10 * 0x10000)

    // then
    expect(id).toBe("st_deadbef0")
  })

  test("#given the previous test poisoned the floor #when a new test allocates #then the id is clock-derived again", () => {
    // when
    const id = createTaskId(0x10 * 0x10000)

    // then
    expect(id).toBe("st_00000010")
  })
})
