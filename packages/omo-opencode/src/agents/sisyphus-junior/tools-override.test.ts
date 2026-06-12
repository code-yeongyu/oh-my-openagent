import { describe, expect, test } from "bun:test"
import { createSisyphusJuniorAgentWithOverrides } from "./index"

describe("createSisyphusJuniorAgentWithOverrides tools override", () => {
  test("#given tools override denies grep #when agent is created #then permission denies grep", () => {
    // given
    const override = {
      tools: {
        grep: false,
      },
    }

    // when
    const result = createSisyphusJuniorAgentWithOverrides(override)

    // then
    expect(result.permission?.grep).toBe("deny")
  })

  test("#given GPT tools override allows task #when agent is created #then hard safety denies task and apply_patch", () => {
    // given
    const override = {
      tools: {
        task: true,
      },
    }

    // when
    const result = createSisyphusJuniorAgentWithOverrides(override, "openai/gpt-5.5")

    // then
    expect(result.permission?.task).toBe("deny")
    expect(result.permission?.apply_patch).toBe("deny")
  })
})
