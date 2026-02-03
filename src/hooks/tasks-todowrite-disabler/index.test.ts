import { describe, expect, test } from "bun:test"

const { createTasksTodowriteDisablerHook } = await import("./index")

describe("tasks-todowrite-disabler", () => {
  describe("when experimental.task_system is enabled", () => {
    test("should block TodoWrite tool", async () => {
      // given
      const hook = createTasksTodowriteDisablerHook({ experimental: { task_system: true } })
      const input = {
        tool: "TodoWrite",
        sessionID: "test-session",
        callID: "call-1",
      }
      const output = {
        args: {},
      }

      // when / then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("TodoRead/TodoWrite are DISABLED")
    })

    test("should block TodoRead tool", async () => {
      // given
      const hook = createTasksTodowriteDisablerHook({ experimental: { task_system: true } })
      const input = {
        tool: "TodoRead",
        sessionID: "test-session",
        callID: "call-1",
      }
      const output = {
        args: {},
      }

      // when / then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("TodoRead/TodoWrite are DISABLED")
    })

    test("should not block other tools", async () => {
      // given
      const hook = createTasksTodowriteDisablerHook({ experimental: { task_system: true } })
      const input = {
        tool: "Read",
        sessionID: "test-session",
        callID: "call-1",
      }
      const output = {
        args: {},
      }

      // when / then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })
  })

  describe("when experimental.task_system is disabled or undefined", () => {
    test("should not block TodoWrite when flag is false", async () => {
      // given
      const hook = createTasksTodowriteDisablerHook({ experimental: { task_system: false } })
      const input = {
        tool: "TodoWrite",
        sessionID: "test-session",
        callID: "call-1",
      }
      const output = {
        args: {},
      }

      // when / then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should not block TodoWrite when experimental is undefined", async () => {
      // given
      const hook = createTasksTodowriteDisablerHook({})
      const input = {
        tool: "TodoWrite",
        sessionID: "test-session",
        callID: "call-1",
      }
      const output = {
        args: {},
      }

      // when / then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should not block TodoRead when flag is false", async () => {
      // given
      const hook = createTasksTodowriteDisablerHook({ experimental: { task_system: false } })
      const input = {
        tool: "TodoRead",
        sessionID: "test-session",
        callID: "call-1",
      }
      const output = {
        args: {},
      }

      // when / then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })
  })

  describe("error message content", () => {
    test("should include replacement message with task tools info", async () => {
      // given
      const hook = createTasksTodowriteDisablerHook({ experimental: { task_system: true } })
      const input = {
        tool: "TodoWrite",
        sessionID: "test-session",
        callID: "call-1",
      }
      const output = {
        args: {},
      }

      // when / then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow(/TaskCreate|TaskUpdate|TaskList|TaskGet/)
    })
  })
})
