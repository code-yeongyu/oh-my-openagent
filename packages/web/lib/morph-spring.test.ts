import { describe, expect, test } from "bun:test"

import {
  FOLD_EPSILON,
  SPRING_LEAD,
  SPRING_TRAIL,
  SpringTrack,
  residualBound,
  springStep,
  type Spring,
} from "./morph-spring"

const CRITICAL: Spring = { omega: 10, zeta: 1 }
const OVERDAMPED: Spring = { omega: 8, zeta: 1.4 }

describe("springStep", () => {
  test("#given the lead spring #when sampled #then it starts at rest, overshoots slightly and settles at 1", () => {
    const samples = Array.from({ length: 200 }, (_, i) => springStep(i / 100, SPRING_LEAD))

    expect(springStep(0, SPRING_LEAD)).toBe(0)
    expect(Math.max(...samples)).toBeGreaterThan(1)
    expect(Math.max(...samples)).toBeLessThan(1.05)
    expect(springStep(3, SPRING_LEAD)).toBeCloseTo(1, 6)
  })

  test("#given the trail spring #when compared with the lead at the same instant #then it lags behind", () => {
    expect(springStep(0.12, SPRING_TRAIL)).toBeLessThan(springStep(0.12, SPRING_LEAD))
  })

  test("#given an overdamped spring #when sampled #then it never overshoots", () => {
    const creep = { omega: 8, zeta: 1.4 }
    const samples = Array.from({ length: 300 }, (_, i) => springStep(i / 100, creep))

    expect(Math.max(...samples)).toBeLessThanOrEqual(1)
    expect(samples.at(-1)).toBeCloseTo(1, 2)
  })
})

describe("residualBound", () => {
  test.each([
    ["lead", SPRING_LEAD],
    ["trail", SPRING_TRAIL],
    ["critical", CRITICAL],
    ["overdamped", OVERDAMPED],
  ] as const)(
    "#given the %s spring #when sampled for 4s #then it bounds the distance to rest",
    (_, spring) => {
      for (let i = 1; i <= 4000; i++) {
        const t = i / 1000
        expect(Math.abs(1 - springStep(t, spring))).toBeLessThanOrEqual(
          residualBound(t, spring) + 1e-12,
        )
      }
    },
  )
})

describe("SpringTrack", () => {
  test.each([
    ["lead", SPRING_LEAD],
    ["trail", SPRING_TRAIL],
    ["critical", CRITICAL],
    ["overdamped", OVERDAMPED],
  ] as const)(
    "#given a large %s move #when changes are folded #then the value never departs from the exact sum of steps",
    (_, spring) => {
      const track = new SpringTrack(0)
      track.retarget(1000, 0, spring)
      track.retarget(-400, 0.35, spring)
      let maxError = 0
      for (let i = 0; i <= 6000; i++) {
        const t = i / 1000
        const exact = 1000 * springStep(t, spring) - 1400 * springStep(t - 0.35, spring)
        maxError = Math.max(maxError, Math.abs(track.valueAt(t) - exact))
      }
      expect(maxError).toBeLessThan(FOLD_EPSILON)
      expect(track.isSettled(6)).toBe(true)
    },
  )

  test("#given a retarget mid-flight #when sampled #then the value is continuous and reaches the final target", () => {
    const track = new SpringTrack(0)
    track.retarget(100, 0, SPRING_LEAD)
    const beforeRetarget = track.valueAt(0.1)
    track.retarget(40, 0.1, SPRING_LEAD)
    const atRetarget = track.valueAt(0.1)

    expect(atRetarget).toBeCloseTo(beforeRetarget, 6)
    expect(track.valueAt(5)).toBeCloseTo(40, 3)
    expect(track.isSettled(5)).toBe(true)
  })

  test("#given a retarget to the current target #when sampled #then nothing moves", () => {
    const track = new SpringTrack(12)
    track.retarget(12, 0, SPRING_LEAD)

    expect(track.valueAt(0.05)).toBe(12)
    expect(track.isSettled(0)).toBe(true)
  })
})
