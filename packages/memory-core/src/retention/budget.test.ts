import { describe, expect, test } from "bun:test"

import { PassBudget } from "./budget"

describe("PassBudget resume point (REVIEW-5 L2)", () => {
  test("#given a resumed pass inside journals #when the budget runs out before its first admitted item #then the cursor keeps the resumed lastName", () => {
    let clock = 0
    const budget = new PassBudget(() => clock, 10, undefined, { store: "journals", lastName: "s-200" })
    clock = 11

    expect(budget.admit("journals")).toBe(false)
    expect(budget.stopped).toEqual({ store: "journals", lastName: "s-200" })
  })

  test("#given a resumed pass inside journals #when the budget runs out in a later store before any item #then the cursor names that later store", () => {
    let clock = 0
    const budget = new PassBudget(() => clock, 10, undefined, { store: "journals", lastName: "s-200" })
    clock = 11

    expect(budget.admit("sidecars")).toBe(false)
    expect(budget.stopped).toEqual({ store: "sidecars" })
  })

  test("#given items finished this pass #when the budget runs out #then the cursor is the last finished item", () => {
    let clock = 0
    const budget = new PassBudget(() => clock, 10, undefined, { store: "journals", lastName: "s-200" })
    expect(budget.admit("journals")).toBe(true)
    budget.done("journals", "s-300")
    clock = 11

    expect(budget.admit("journals")).toBe(false)
    expect(budget.stopped).toEqual({ store: "journals", lastName: "s-300" })
  })
})
