import { describe, expect, test } from "bun:test"

import { createGptPermissionContinuationHook } from "."

type SessionMessage = {
  info: {
    id: string
    role: "user" | "assistant"
    model?: {
      providerID?: string
      modelID?: string
    }
    modelID?: string
  }
  parts?: Array<{ type: string; text?: string }>
}

function createMockPluginInput(messages: SessionMessage[]) {
  const promptCalls: string[] = []

  const ctx = {
    directory: "/tmp/test",
    client: {
      session: {
        messages: async () => ({ data: messages }),
        prompt: async (input: { body: { parts: Array<{ text: string }> } }) => {
          promptCalls.push(input.body.parts[0]?.text ?? "")
          return {}
        },
        promptAsync: async (input: { body: { parts: Array<{ text: string }> } }) => {
          promptCalls.push(input.body.parts[0]?.text ?? "")
          return {}
        },
      },
    },
  } as any

  return { ctx, promptCalls }
}

describe("gpt-permission-continuation", () => {
  test("injects continue when the last GPT assistant reply asks for permission", async () => {
    // given
    const { ctx, promptCalls } = createMockPluginInput([
      {
        info: { id: "msg-1", role: "assistant", modelID: "gpt-5.4" },
        parts: [{ type: "text", text: "I finished the analysis. If you want, I can apply the changes next." }],
      },
    ])
    const hook = createGptPermissionContinuationHook(ctx)

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

    // then
    expect(promptCalls).toEqual(["continue"])
  })

  test("does not inject when the last assistant model is not GPT", async () => {
    // given
    const { ctx, promptCalls } = createMockPluginInput([
      {
        info: {
          id: "msg-1",
          role: "assistant",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        },
        parts: [{ type: "text", text: "If you want, I can keep going." }],
      },
    ])
    const hook = createGptPermissionContinuationHook(ctx)

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

    // then
    expect(promptCalls).toEqual([])
  })

  test("does not inject when the last assistant reply is not a stall pattern", async () => {
    // given
    const { ctx, promptCalls } = createMockPluginInput([
      {
        info: { id: "msg-1", role: "assistant", modelID: "gpt-5.4" },
        parts: [{ type: "text", text: "I completed the refactor and all tests pass." }],
      },
    ])
    const hook = createGptPermissionContinuationHook(ctx)

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

    // then
    expect(promptCalls).toEqual([])
  })

  test("does not inject when a permission phrase appears before the final sentence", async () => {
    // given
    const { ctx, promptCalls } = createMockPluginInput([
      {
        info: { id: "msg-1", role: "assistant", modelID: "gpt-5.4" },
        parts: [{ type: "text", text: "If you want, I can keep going. The current work is complete." }],
      },
    ])
    const hook = createGptPermissionContinuationHook(ctx)

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

    // then
    expect(promptCalls).toEqual([])
  })

  test("does not inject when continuation is stopped for the session", async () => {
    // given
    const { ctx, promptCalls } = createMockPluginInput([
      {
        info: { id: "msg-1", role: "assistant", modelID: "gpt-5.4" },
        parts: [{ type: "text", text: "If you want, I can continue with the fix." }],
      },
    ])
    const hook = createGptPermissionContinuationHook(ctx, {
      isContinuationStopped: (sessionID) => sessionID === "ses-1",
    })

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

    // then
    expect(promptCalls).toEqual([])
  })

  test("does not inject twice for the same assistant message", async () => {
    // given
    const { ctx, promptCalls } = createMockPluginInput([
      {
        info: { id: "msg-1", role: "assistant", modelID: "gpt-5.4" },
        parts: [{ type: "text", text: "Would you like me to continue with the fix?" }],
      },
    ])
    const hook = createGptPermissionContinuationHook(ctx)

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

    // then
    expect(promptCalls).toEqual(["continue"])
  })
})
