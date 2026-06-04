/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { raiseProcessListenersCap } from "./raise-process-listeners-cap"

describe("raiseProcessListenersCap (#4334)", () => {
  const originalCap = process.getMaxListeners()

  afterEach(() => {
    process.setMaxListeners(originalCap)
  })

  test("#given current cap below the minimum #when raising #then it bumps to the minimum", () => {
    // given
    process.setMaxListeners(10)

    // when
    raiseProcessListenersCap(64)

    // then
    expect(process.getMaxListeners()).toBe(64)
  })

  test("#given current cap already at or above the minimum #when raising #then it is left untouched", () => {
    // given
    process.setMaxListeners(200)

    // when
    raiseProcessListenersCap(64)

    // then - never lowered
    expect(process.getMaxListeners()).toBe(200)
  })

  test("#given repeated calls with the same minimum #when raising #then it is idempotent", () => {
    // given
    process.setMaxListeners(10)

    // when
    raiseProcessListenersCap(64)
    raiseProcessListenersCap(64)
    raiseProcessListenersCap(64)

    // then
    expect(process.getMaxListeners()).toBe(64)
  })
})
