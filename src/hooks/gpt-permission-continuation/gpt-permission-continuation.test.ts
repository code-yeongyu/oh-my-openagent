/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, it as test } from "bun:test"

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

function createAssistantMessage(id: string, text: string): SessionMessage {
  return {
    info: { id, role: "assistant", modelID: "gpt-5.4" },
    parts: [{ type: "text", text }],
  }
}

function createUserMessage(id: string, text: string): SessionMessage {
  return {
    info: { id, role: "user" },
    parts: [{ type: "text", text }],
  }
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

  describe("#given repeated GPT permission tails in the same session", () => {
    describe("#when the permission phrases keep changing", () => {
      test("stops injecting after three consecutive auto-continues", async () => {
        // given
        const messages: SessionMessage[] = [
          createUserMessage("msg-0", "Please continue the fix."),
          createAssistantMessage("msg-1", "If you want, I can apply the patch next."),
        ]
        const { ctx, promptCalls } = createMockPluginInput(messages)
        const hook = createGptPermissionContinuationHook(ctx)

        // when
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
        messages.push(createUserMessage("msg-2", "continue"))
        messages.push(createAssistantMessage("msg-3", "Would you like me to continue with the tests?"))
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
        messages.push(createUserMessage("msg-4", "continue"))
        messages.push(createAssistantMessage("msg-5", "Do you want me to wire the remaining cleanup?"))
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
        messages.push(createUserMessage("msg-6", "continue"))
        messages.push(createAssistantMessage("msg-7", "Shall I finish the remaining updates?"))
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

        // then
        expect(promptCalls).toEqual(["continue", "continue", "continue"])
      })
    })

    describe("#when a real user message arrives between auto-continues", () => {
      test("resets the consecutive auto-continue counter", async () => {
        // given
        const messages: SessionMessage[] = [
          createUserMessage("msg-0", "Please continue the fix."),
          createAssistantMessage("msg-1", "If you want, I can apply the patch next."),
        ]
        const { ctx, promptCalls } = createMockPluginInput(messages)
        const hook = createGptPermissionContinuationHook(ctx)

        // when
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
        messages.push(createUserMessage("msg-2", "continue"))
        messages.push(createAssistantMessage("msg-3", "Would you like me to continue with the tests?"))
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
        messages.push(createUserMessage("msg-4", "Please keep going and finish the cleanup."))
        messages.push(createAssistantMessage("msg-5", "Do you want me to wire the remaining cleanup?"))
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
        messages.push(createUserMessage("msg-6", "continue"))
        messages.push(createAssistantMessage("msg-7", "Shall I finish the remaining updates?"))
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
        messages.push(createUserMessage("msg-8", "continue"))
        messages.push(createAssistantMessage("msg-9", "If you want, I can apply the final polish."))
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
        messages.push(createUserMessage("msg-10", "continue"))
        messages.push(createAssistantMessage("msg-11", "Would you like me to ship the final verification?"))
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

        // then
        expect(promptCalls).toEqual(["continue", "continue", "continue", "continue", "continue"])
      })
    })

    describe("#when the same permission phrase repeats after an auto-continue", () => {
      test("stops immediately on stagnation", async () => {
        // given
        const messages: SessionMessage[] = [
          createUserMessage("msg-0", "Please continue the fix."),
          createAssistantMessage("msg-1", "If you want, I can apply the patch next."),
        ]
        const { ctx, promptCalls } = createMockPluginInput(messages)
        const hook = createGptPermissionContinuationHook(ctx)

        // when
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
        messages.push(createUserMessage("msg-2", "continue"))
        messages.push(createAssistantMessage("msg-3", "If you want, I can apply the patch next."))
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

        // then
        expect(promptCalls).toEqual(["continue"])
      })
    })
  })
})
