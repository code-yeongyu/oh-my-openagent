import { describe, expect, test } from "bun:test"

import { createTodoContinuationEnforcer } from "../todo-continuation-enforcer"
import { createGptPermissionContinuationHook } from "."

describe("gpt-permission-continuation coordination", () => {
  test("injects only once when GPT permission continuation and todo continuation are both eligible", async () => {
    // given
    const promptCalls: string[] = []
    const toastCalls: string[] = []
    const sessionID = "ses-dual-continuation"
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          messages: async () => ({
            data: [
              {
                info: { id: "msg-1", role: "assistant", modelID: "gpt-5.4" },
                parts: [{ type: "text", text: "If you want, I can implement the fix next." }],
              },
            ],
          }),
          todo: async () => ({
            data: [{ id: "1", content: "Task 1", status: "pending", priority: "high" }],
          }),
          prompt: async (input: { body: { parts: Array<{ text: string }> } }) => {
            promptCalls.push(input.body.parts[0]?.text ?? "")
            return {}
          },
          promptAsync: async (input: { body: { parts: Array<{ text: string }> } }) => {
            promptCalls.push(input.body.parts[0]?.text ?? "")
            return {}
          },
        },
        tui: {
          showToast: async (input: { body: { title: string } }) => {
            toastCalls.push(input.body.title)
            return {}
          },
        },
      },
    } as any

    const gptPermissionContinuation = createGptPermissionContinuationHook(ctx)
    const todoContinuationEnforcer = createTodoContinuationEnforcer(ctx, {
      shouldSkipContinuation: (id) => gptPermissionContinuation.wasRecentlyInjected(id),
    })

    // when
    await gptPermissionContinuation.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await todoContinuationEnforcer.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].startsWith("continue")).toBe(true)
    expect(promptCalls[0]).toContain("If you want, I can implement the fix next.")
    expect(toastCalls).toEqual([])
  })
})
