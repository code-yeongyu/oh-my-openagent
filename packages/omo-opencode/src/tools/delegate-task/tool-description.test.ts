import { describe, expect, test } from "bun:test"

import { CATEGORY_PROMPT_APPENDS } from "./builtin-categories"
import { createDelegateTaskPresentation } from "./tool-description"

describe("createDelegateTaskPresentation", () => {
  test("#given a model-gated builtin #when presentation is built #then its required models are exposed", () => {
    //#given
    const expectedModels = ["gpt-6-astra"]

    //#when
    const category = createDelegateTaskPresentation({}).availableCategories
      .find(({ name }) => name === "deep-high")

    //#then
    expect(category?.requiredModels).toEqual(expectedModels)
  })

  test("#given caller-directed category guidance #when presentation is built #then guidance reaches only the caller", () => {
    //#given
    const callerDirectedCategories = ["quick", "unspecified-low", "unspecified-high"]

    //#when
    const presentation = createDelegateTaskPresentation({})

    //#then
    expect(presentation.description).toContain("<Selection_Gate>")
    expect(presentation.description).toContain("<Caller_Warning>")
    for (const category of callerDirectedCategories) {
      expect(CATEGORY_PROMPT_APPENDS[category]).toContain("<Category_Context>")
      expect(CATEGORY_PROMPT_APPENDS[category]).not.toContain("<Selection_Gate>")
      expect(CATEGORY_PROMPT_APPENDS[category]).not.toContain("<Caller_Warning>")
    }
  })
})
