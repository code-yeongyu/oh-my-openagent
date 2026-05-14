/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import {
  setOverride,
  getOverride,
  clearOverride,
  tryConsumeBudget,
  getBudgetSpent,
  resetSession,
  _resetAllForTests,
} from "./state"

describe("roles-models state", () => {
  beforeEach(() => {
    _resetAllForTests()
  })

  describe("overrides", () => {
    test("#when setOverride is called #then getOverride returns it", () => {
      setOverride("s1", "sisyphus", { model: "anthropic/claude-opus-4-7", variant: "max" })

      expect(getOverride("s1", "sisyphus")).toEqual({
        model: "anthropic/claude-opus-4-7",
        variant: "max",
      })
    })

    test("#given an override #when clearOverride is called #then it returns undefined", () => {
      setOverride("s1", "sisyphus", { model: "x/y" })
      clearOverride("s1", "sisyphus")

      expect(getOverride("s1", "sisyphus")).toBeUndefined()
    })

    test("overrides are scoped per session", () => {
      setOverride("s1", "sisyphus", { model: "x/y" })

      expect(getOverride("s2", "sisyphus")).toBeUndefined()
    })
  })

  describe("budget", () => {
    test("#given a budget of 2 #when consumed 3 times #then the third returns false", () => {
      expect(tryConsumeBudget("s1", "sisyphus", 2)).toBe(true)
      expect(tryConsumeBudget("s1", "sisyphus", 2)).toBe(true)
      expect(tryConsumeBudget("s1", "sisyphus", 2)).toBe(false)
      expect(getBudgetSpent("s1", "sisyphus")).toBe(2)
    })

    test("budget is per-role", () => {
      tryConsumeBudget("s1", "sisyphus", 1)

      expect(getBudgetSpent("s1", "sisyphus")).toBe(1)
      expect(getBudgetSpent("s1", "hephaestus")).toBe(0)
    })

    test("resetSession clears budget and overrides", () => {
      setOverride("s1", "sisyphus", { model: "x/y" })
      tryConsumeBudget("s1", "sisyphus", 5)
      resetSession("s1")

      expect(getOverride("s1", "sisyphus")).toBeUndefined()
      expect(getBudgetSpent("s1", "sisyphus")).toBe(0)
    })
  })
})
