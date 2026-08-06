import { describe, expect, test } from "bun:test"

import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { hasIncompleteTodos } from "./session-todo-status"

describe("hasIncompleteTodos", () => {
  test("#given todo fetch fails with an Error #when checking incomplete todos #then it returns the no-todo fallback", async () => {
    // given
    const ctx = {
      client: {
        session: {
          todo: async () => {
            throw new Error("todo fetch failed")
          },
        },
      },
    }

    // when
    const result = await hasIncompleteTodos(unsafeTestValue(ctx), "ses_error")

    // then
    expect(result).toBe(false)
  })

  test("#given todo fetch fails with a non-Error #when checking incomplete todos #then it returns the no-todo fallback", async () => {
    // given
    const thrown = { kind: "todo-thrown-value" } as const
    const ctx = {
      client: {
        session: {
          todo: async () => {
            throw thrown
          },
        },
      },
    }

    // when
    const result = await hasIncompleteTodos(unsafeTestValue(ctx), "ses_non_error")

    // then
    expect(result).toBe(false)
  })
})
