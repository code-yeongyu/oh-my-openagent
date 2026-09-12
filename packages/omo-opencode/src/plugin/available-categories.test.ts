import { describe, expect, test } from "bun:test"

import { createAvailableCategories } from "./available-categories"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

describe("createAvailableCategories", () => {
  test("#given a category configured with a legacy model #when the roster is built #then the model is exposed", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      categories: {
        quick: { model: "quotio/legacy-primary" },
      },
    })

    //#when
    const categories = createAvailableCategories(pluginConfig)

    //#then
    const quick = categories.find((category) => category.name === "quick")
    expect(quick?.model).toBe("quotio/legacy-primary")
  })

  test("#given a category configured with a canonical models chain #when the roster is built #then the chain primary is exposed instead of undefined (issue #6868)", () => {
    //#given - available-categories used to read only the legacy .model key
    const pluginConfig = unsafeTestValue({
      categories: {
        quick: {
          models: ["opencode-go/deepseek-v4-pro", "opencode-go/qwen3.7-plus"],
        },
      },
    })

    //#when
    const categories = createAvailableCategories(pluginConfig)

    //#then
    const quick = categories.find((category) => category.name === "quick")
    expect(quick?.model).toBe("opencode-go/deepseek-v4-pro")
  })

  test("#given both model and models on one category #when the roster is built #then the legacy model leads the entry", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      categories: {
        deep: {
          model: "opencode-go/deepseek-v4-pro",
          models: ["opencode-go/qwen3.7-plus"],
        },
      },
    })

    //#when
    const categories = createAvailableCategories(pluginConfig)

    //#then
    const deep = categories.find((category) => category.name === "deep")
    expect(deep?.model).toBe("opencode-go/deepseek-v4-pro")
  })
})
