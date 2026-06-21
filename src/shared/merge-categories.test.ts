import { describe, expect, it } from "bun:test"
import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants"
import { mergeCategories } from "./merge-categories"

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
      "bullet-time": { disable: true },
    }

    //#when
    const result = mergeCategories(userCategories)

    //#then
    expect(result["bullet-time"]).toBeUndefined()
    expect(Object.keys(result).length).toBe(Object.keys(DEFAULT_CATEGORIES).length - 1)
  })

  it("keeps categories with disable: false", () => {
    //#given
    const userCategories = {
      "bullet-time": { disable: false },
    }

    //#when
    const result = mergeCategories(userCategories)

    //#then
    expect(result["bullet-time"]).toBeDefined()
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
      "source": { model: "anthropic/claude-opus-4-6" },
    }

    //#when
    const result = mergeCategories(userCategories)

    //#then
    expect(result["source"]).toBeDefined()
    expect(result["source"].model).toBe("anthropic/claude-opus-4-6")
  })
})
