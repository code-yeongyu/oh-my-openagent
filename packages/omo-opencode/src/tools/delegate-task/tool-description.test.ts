import { describe, expect, test } from "bun:test"

import { CATEGORY_PROMPT_APPENDS } from "./builtin-categories"
import { createDelegateTaskPresentation } from "./tool-description"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("createDelegateTaskPresentation", () => {
  test("#given sync task usage #when description is rendered #then timeout is described as inactivity based", () => {
    //#given
    const presentation = createDelegateTaskPresentation({})

    //#when
    const description = presentation.description

    //#then
    expect(description).toContain("30-minute inactivity window")
    expect(description).toContain("busy/retry/running")
    expect(description).toContain("not a total wall-clock limit")
  })

  test("#given continuation usage #when description is rendered #then task_id is described as a session id", () => {
    //#given
    const presentation = createDelegateTaskPresentation({})

    //#when
    const description = presentation.description

    //#then
    expect(description).toContain("task_id: Continuation session id")
    expect(description).toContain("ses_")
    expect(description).toContain("not the background task id")
    expect(description).toContain("bg_")
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

  test("#given a user category with a canonical models chain #when presentation is built #then the roster row shows the chain primary (issue #6868)", () => {
    //#given
    const userCategories = unsafeTestValue({
      quick: {
        models: ["opencode-go/deepseek-v4-pro", "opencode-go/qwen3.7-plus"],
      },
    })

    //#when
    const presentation = createDelegateTaskPresentation({ userCategories })

    //#then
    const quick = presentation.availableCategories.find((category) => category.name === "quick")
    expect(quick?.model).toBe("opencode-go/deepseek-v4-pro")
  })
})
