import { describe, expect, test } from "bun:test"

import { clampScroll, popupBudget, POPUP_CHROME_ROWS } from "./viewport"

describe("popupBudget", () => {
  test("#given any terminal height #when budgeted #then the popup never asks for more rows than exist", () => {
    // given
    const heights = Array.from({ length: 75 }, (_, index) => index + 6)

    // when
    const overflowing = heights.filter((rows) => popupBudget(rows, 0.72).total > rows)

    // then
    expect(overflowing).toEqual([])
  })

  test("#given any terminal height #when budgeted #then at least one content row remains", () => {
    // given
    const heights = Array.from({ length: 75 }, (_, index) => index + 6)

    // when
    const starved = heights.filter((rows) => popupBudget(rows, 0.72).body < 1)

    // then
    expect(starved).toEqual([])
  })

  test("#given a typical terminal #when budgeted #then the body is the total minus the frame", () => {
    // given
    const rows = 50

    // when
    const budget = popupBudget(rows, 0.72)

    // then
    expect(budget.total).toBe(36)
    expect(budget.body).toBe(36 - POPUP_CHROME_ROWS)
  })

  test("#given a nonsense ratio or height #when budgeted #then sane defaults are used", () => {
    // given
    const cases = [popupBudget(0, 0.72), popupBudget(50, 0), popupBudget(50, 4)]

    // when
    const totals = cases.map((budget) => budget.total)

    // then
    expect(totals[0]).toBe(17)
    expect(totals[1]).toBe(36)
    expect(totals[2]).toBe(50)
  })
})

describe("clampScroll", () => {
  test("#given a scroll past the end #when clamped #then it stops at the last full screen", () => {
    // given
    const scroll = 999

    // when
    const clamped = clampScroll(scroll, 100, 30)

    // then
    expect(clamped).toBe(70)
  })

  test("#given content shorter than the body #when clamped #then scrolling is pinned to the top", () => {
    // given
    const scroll = 5

    // when
    const clamped = clampScroll(scroll, 10, 30)

    // then
    expect(clamped).toBe(0)
  })

  test("#given a negative scroll #when clamped #then it lands at the top", () => {
    // given
    const scroll = -4

    // when
    const clamped = clampScroll(scroll, 100, 30)

    // then
    expect(clamped).toBe(0)
  })
})
