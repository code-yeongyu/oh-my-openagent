import { describe, expect, test } from "bun:test"

import { isDriver } from "./driver.ts"

describe("driver modules loaded by run.ts --driver", () => {
  test("a module's driver is accepted only when it runs both cells and tasks", () => {
    const runCell = async () => {
      throw new Error("not called")
    }
    expect(isDriver({ runCell, runTask: runCell })).toBe(true)
    expect(isDriver({ runCell })).toBe(false)
    expect(isDriver({ runCell, runTask: "later" })).toBe(false)
    expect(isDriver(undefined)).toBe(false)
  })
})
