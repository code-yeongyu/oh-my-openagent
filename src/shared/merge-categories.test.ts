import { describe, it, expect } from "bun:test"
import { mergeCategories } from "./merge-categories"
import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants"

describe("mergeCategories", () => {
  it("returns all default categories when no user config provided", () => {
    //#given
    const userCategories = undefined

    //#when
    const result = mergeCategories(userCategories)

    //#then
    expect(Object.keys(result)).toEqual(Object.keys(DEFAULT_CATEGORIES))
  })

  it("filters out categories with disable: true", () => {
    //#given
    const userCategories = {
      "quick": { disable: true },
    }

    //#when
    const result = mergeCategories(userCategories)

    //#then
    expect(result["quick"]).toBeUndefined()
    expect(Object.keys(result).length).toBe(Object.keys(DEFAULT_CATEGORIES).length - 1)
  })

  it("keeps categories with disable: false", () => {
    //#given
    const userCategories = {
      "quick": { disable: false },
    }

    //#when
    const result = mergeCategories(userCategories)

    //#then
    expect(result["quick"]).toBeDefined()
  })

  it("allows user to add custom categories", () => {
    //#given
    const userCategories = {
      "my-custom": { model: "openai/gpt-5.2", description: "Custom category" },
    }

    //#when
    const result = mergeCategories(userCategories)

    //#then
    expect(result["my-custom"]).toBeDefined()
    expect(result["my-custom"].model).toBe("openai/gpt-5.2")
  })

  it("allows user to disable custom categories", () => {
    //#given
    const userCategories = {
      "my-custom": { model: "openai/gpt-5.2", disable: true },
    }

    //#when
    const result = mergeCategories(userCategories)

    //#then
    expect(result["my-custom"]).toBeUndefined()
  })

  it("user overrides merge with defaults", () => {
    //#given
    const userCategories = {
      "ultrabrain": { model: "anthropic/claude-opus-4-6" },
    }

    //#when
    const result = mergeCategories(userCategories)

    //#then
    expect(result["ultrabrain"]).toBeDefined()
    expect(result["ultrabrain"].model).toBe("anthropic/claude-opus-4-6")
  })
})
