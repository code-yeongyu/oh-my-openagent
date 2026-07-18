import { describe, expect, test } from "bun:test"

import { clampWaitTimeout } from "./clamp"

const BOUNDS = { min_ms: 5000, default_ms: 60000, max_ms: 600000 } as const

describe("clampWaitTimeout", () => {
  test("#given below-min timeout #when clamped #then rises to min", () => {
    // given
    const requested = 4999
    // when
    const clamped = clampWaitTimeout(requested, BOUNDS)
    // then
    expect(clamped).toBe(5000)
  })

  test("#given exactly min timeout #when clamped #then unchanged", () => {
    // given / when / then
    expect(clampWaitTimeout(5000, BOUNDS)).toBe(5000)
  })

  test("#given above-max timeout #when clamped #then falls to max", () => {
    // given
    const requested = 999999
    // when
    const clamped = clampWaitTimeout(requested, BOUNDS)
    // then
    expect(clamped).toBe(600000)
  })

  test("#given exactly max timeout #when clamped #then unchanged", () => {
    // given / when / then
    expect(clampWaitTimeout(600000, BOUNDS)).toBe(600000)
  })

  test("#given an in-range timeout #when clamped #then passes through", () => {
    // given / when / then
    expect(clampWaitTimeout(30000, BOUNDS)).toBe(30000)
  })

  test("#given no timeout #when clamped #then uses the configured default", () => {
    // given / when / then
    expect(clampWaitTimeout(undefined, BOUNDS)).toBe(60000)
  })
})
