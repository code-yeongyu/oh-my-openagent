import { describe, test, expect } from "bun:test"
import { DEFAULT_CATEGORIES } from "../tools/sisyphus-task/constants"
import type { CategoryConfig } from "../config/schema"

function resolveModelFromCategoryWithUserOverride(
  categoryName: string,
  userCategories?: Record<string, CategoryConfig>
): string | undefined {
  const categoryConfig = userCategories?.[categoryName] ?? DEFAULT_CATEGORIES[categoryName]
  return categoryConfig?.model
}

describe("Prometheus category model resolution", () => {
  test("resolves ultrabrain category to openai/gpt-5.2", () => {
    // #given
    const categoryName = "ultrabrain"

    // #when
    const model = resolveModelFromCategoryWithUserOverride(categoryName)

    // #then
    expect(model).toBe("openai/gpt-5.2")
  })

  test("resolves visual-engineering category to gemini model", () => {
    // #given
    const categoryName = "visual-engineering"

    // #when
    const model = resolveModelFromCategoryWithUserOverride(categoryName)

    // #then
    expect(model).toBe("google/gemini-3-pro-preview")
  })

  test("user categories override default categories", () => {
    // #given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      ultrabrain: {
        model: "google/antigravity-claude-opus-4-5-thinking",
        temperature: 0.1,
      },
    }

    // #when
    const model = resolveModelFromCategoryWithUserOverride(categoryName, userCategories)

    // #then
    expect(model).toBe("google/antigravity-claude-opus-4-5-thinking")
  })

  test("returns undefined for unknown category", () => {
    // #given
    const categoryName = "nonexistent-category"

    // #when
    const model = resolveModelFromCategoryWithUserOverride(categoryName)

    // #then
    expect(model).toBeUndefined()
  })

  test("falls back to default when user category has no entry", () => {
    // #given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      "visual-engineering": {
        model: "custom/visual-model",
      },
    }

    // #when
    const model = resolveModelFromCategoryWithUserOverride(categoryName, userCategories)

    // #then
    expect(model).toBe("openai/gpt-5.2")
  })
})
