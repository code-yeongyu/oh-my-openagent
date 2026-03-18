/// <reference path="../../../bun-test.d.ts" />

import { createOpencodeClient } from "@opencode-ai/sdk"
import { afterEach, describe, expect, it as test } from "bun:test"

import { subagentSessions, _resetForTesting } from "../../features/claude-code-session-state"
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

type GptPermissionContext = Parameters<typeof createGptPermissionContinuationHook>[0]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function extractPromptText(input: unknown): string {
  if (!isRecord(input)) return ""

  const body = input.body
  if (!isRecord(body)) return ""

  const parts = body.parts
  if (!Array.isArray(parts)) return ""

  const firstPart = parts[0]
  if (!isRecord(firstPart)) return ""

  return typeof firstPart.text === "string" ? firstPart.text : ""
}

function createMockPluginInput(messages: SessionMessage[]): {
  ctx: GptPermissionContext
  promptCalls: string[]
} {
  const promptCalls: string[] = []
  const client = createOpencodeClient({ directory: "/tmp/test" })
  const shell = Object.assign(
    () => {
      throw new Error("$ is not used in this test")
    },
    {
      braces: () => [],
      escape: (input: string) => input,
      env() {
        return shell
      },
      cwd() {
        return shell
      },
      nothrow() {
        return shell
      },
      throws() {
        return shell
      },
    },
  )
  const request = new Request("http://localhost")
  const response = new Response()

  Reflect.set(client.session, "messages", async () => ({ data: messages, error: undefined, request, response }))
  Reflect.set(client.session, "prompt", async (input: unknown) => {
    promptCalls.push(extractPromptText(input))
    return { data: undefined, error: undefined, request, response }
  })
  Reflect.set(client.session, "promptAsync", async (input: unknown) => {
    promptCalls.push(extractPromptText(input))
    return { data: undefined, error: undefined, request, response }
  })

  const ctx: GptPermissionContext = {
    client,
    project: {
      id: "test-project",
      worktree: "/tmp/test",
      time: { created: Date.now() },
    },
    directory: "/tmp/test",
    worktree: "/tmp/test",
    serverUrl: new URL("http://localhost"),
    $: shell,
  }

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

function expectContinuationPrompts(promptCalls: string[], count: number): void {
  expect(promptCalls).toHaveLength(count)
  for (const call of promptCalls) {
    expect(call.startsWith("continue")).toBe(true)
  }
}

describe("gpt-permission-continuation", () => {
  afterEach(() => {
    _resetForTesting()
  })

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
    expectContinuationPrompts(promptCalls, 1)
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
    expectContinuationPrompts(promptCalls, 1)
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
        expectContinuationPrompts(promptCalls, 3)
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
        expectContinuationPrompts(promptCalls, 5)
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
        expectContinuationPrompts(promptCalls, 1)
      })
    })

    describe("#when a user manually types continue after the cap is reached", () => {
      test("resets the cap and allows another auto-continue", async () => {
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
        messages.push(createUserMessage("msg-8", "continue"))
        messages.push(createAssistantMessage("msg-9", "If you want, I can apply the final polish."))
        await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

        // then
        expectContinuationPrompts(promptCalls, 4)
      })
    })
  })

  test("does not inject when the session is a subagent session", async () => {
    // given
    const { ctx, promptCalls } = createMockPluginInput([
      {
        info: { id: "msg-1", role: "assistant", modelID: "gpt-5.4" },
        parts: [{ type: "text", text: "If you want, I can continue with the fix." }],
      },
    ])
    subagentSessions.add("ses-subagent")
    const hook = createGptPermissionContinuationHook(ctx)

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-subagent" } } })

    // then
    expect(promptCalls).toEqual([])
  })

  test("includes assistant text context in the continuation prompt", async () => {
    // given
    const assistantText = "I finished the analysis. If you want, I can apply the changes next."
    const { ctx, promptCalls } = createMockPluginInput([
      {
        info: { id: "msg-1", role: "assistant", modelID: "gpt-5.4" },
        parts: [{ type: "text", text: assistantText }],
      },
    ])
    const hook = createGptPermissionContinuationHook(ctx)

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].startsWith("continue")).toBe(true)
    expect(promptCalls[0]).toContain("If you want, I can apply the changes next.")
  })
})
