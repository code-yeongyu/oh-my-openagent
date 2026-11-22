import { describe, expect, test } from "bun:test"

import { PassBudget } from "./budget"

describe("PassBudget resume point (REVIEW-5 L2)", () => {
  test("#given a resumed pass inside journals #when it is aborted before its first admitted item #then the cursor keeps the resumed lastName", () => {
    const controller = new AbortController()
    const budget = new PassBudget(() => 0, 10, controller.signal, { store: "journals", lastName: "s-200" })
    controller.abort()

    expect(budget.admit("journals")).toBe(false)
    expect(budget.aborted).toBe(true)
    expect(budget.stopped).toEqual({ store: "journals", lastName: "s-200" })
  })

  test("#given a resumed pass inside journals #when it is aborted in a later store before any item #then the cursor names that later store", () => {
    const controller = new AbortController()
    const budget = new PassBudget(() => 0, 10, controller.signal, { store: "journals", lastName: "s-200" })
    controller.abort()

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

describe("PassBudget resumability (REVIEW-7 L1)", () => {
  test("#given a pass resumed at journals #when it stops in an earlier store before finishing an item #then the cursor stays at the journals resume point", () => {
    const controller = new AbortController()
    const budget = new PassBudget(() => 0, 10, controller.signal, { store: "journals", lastName: "s-05" })
    controller.abort()

    expect(budget.admit("runs")).toBe(false)
    expect(budget.stopped).toEqual({ store: "journals", lastName: "s-05" })
  })

  test("#given a spent budget #when classification asks to proceed #then only the abort signal stops it", () => {
    let clock = 0
    const controller = new AbortController()
    const budget = new PassBudget(() => clock, 10, controller.signal, { store: "journals", lastName: "s-05" })
    clock = 11

    expect(budget.proceed("runs")).toBe(true)
    expect(budget.stopped).toBeUndefined()

    controller.abort()
    expect(budget.proceed("runs")).toBe(false)
    expect(budget.aborted).toBe(true)
    expect(budget.stopped).toEqual({ store: "journals", lastName: "s-05" })
  })

  test("#given a budget spent before the first item #when removal items are admitted #then the first one still runs and the next one stops at it", () => {
    let clock = 0
    const budget = new PassBudget(() => clock, 10, undefined, undefined)
    clock = 11

    expect(budget.admit("runs")).toBe(true)
    budget.done("runs", "reflection-run-1")
    expect(budget.admit("runs")).toBe(false)
    expect(budget.stopped).toEqual({ store: "runs", lastName: "reflection-run-1" })
  })
})
