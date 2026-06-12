import { describe, expect, test } from "bun:test"

import { REPLACEMENT_MESSAGE } from "./constants"
import { createTasksTodowriteDisablerHook } from "./hook"

describe("createTasksTodowriteDisablerHook", () => {
  describe("#given experimental.task_system is omitted", () => {
    test("#when TodoWrite runs #then it is allowed by default", async () => {
      // given
      const hook = createTasksTodowriteDisablerHook({})

      // when
      const result = hook["tool.execute.before"](
        { tool: "TodoWrite", sessionID: "ses_123", callID: "call_123" },
        { args: {} },
      )

      // then
      await expect(result).resolves.toBeUndefined()
    })
  })

  describe("#given experimental.task_system is enabled", () => {
    test("#when TodoWrite runs #then it is allowed so the live todo panel stays in sync (#3764)", async () => {
      // given
      const hook = createTasksTodowriteDisablerHook({
        experimental: { task_system: true },
      })

      // when
      const result = hook["tool.execute.before"](
        { tool: "TodoWrite", sessionID: "ses_123", callID: "call_123" },
        { args: {} },
      )

      // then: TodoWrite must pass through — blocking it froze the panel
      await expect(result).resolves.toBeUndefined()
    })

    test("#when TodoRead runs #then it is blocked because TaskList/TaskGet replace reads", async () => {
      // given
      const hook = createTasksTodowriteDisablerHook({
        experimental: { task_system: true },
      })

      // when
      const result = hook["tool.execute.before"](
        { tool: "TodoRead", sessionID: "ses_123", callID: "call_123" },
        { args: {} },
      )

      // then
      await expect(result).rejects.toThrow(REPLACEMENT_MESSAGE)
    })
  })
})
