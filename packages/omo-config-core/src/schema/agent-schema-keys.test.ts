import { describe, expect, test } from "bun:test"

import { OmoAgentDefSchema } from "./agent"

describe("agent schema permission and prompt_append keys", () => {
  test("#given an agent carrying permission and prompt_append #when parsed #then both keys are accepted", () => {
    // given
    const definition = {
      description: "a",
      prompt: "p",
      permission: {
        edit: "deny",
        bash: { "rm *": "ask" },
      },
      prompt_append: "x",
    }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.permission).toEqual({
      edit: "deny",
      bash: { "rm *": "ask" },
    })
    expect(result.data.prompt_append).toBe("x")
  })

  test("#given an agent carrying a truly unknown key #when parsed #then strict mode still rejects it", () => {
    // given
    const definition = { bogus_key: 1 }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a permission object with an invalid value #when parsed #then the schema rejects it", () => {
    // given
    const definition = { permission: { edit: "sometimes" } }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(false)
  })
})
