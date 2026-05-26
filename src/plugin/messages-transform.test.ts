import { describe, it, expect } from "bun:test"

import { createMessagesTransformHandler } from "./messages-transform"
import { createToolPairValidatorHook } from "../hooks/tool-pair-validator/hook"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../shared/internal-initiator-marker"
import type { CreatedHooks } from "../create-hooks"

type TestPart = {
  type: string
  id?: string
  sessionID?: string
  messageID?: string
  callID?: string
  tool_use_id?: string
  content?: string
  text?: string
  synthetic?: boolean
  metadata?: { compaction_continue?: boolean }
}

type TestMessage = {
  info: {
    role: "assistant" | "user"
    id?: string
    sessionID?: string
    agent?: string
    model?: { providerID: string; modelID: string }
    system?: string
    tools?: Record<string, boolean>
    providerID?: string
    modelID?: string
  }
  parts: TestPart[]
}

type TransformHook = (
  input: Record<string, never>,
  output: { messages: TestMessage[] },
) => Promise<void>

function makeHook(handler: TransformHook): NonNullable<CreatedHooks["toolPairValidator"]> {
  return {
    "experimental.chat.messages.transform": handler as never,
  } as never
}

function makeHooks(overrides: {
  contextInjector?: TransformHook
  thinkingBlock?: TransformHook
  toolPair?: TransformHook
}): CreatedHooks {
  return {
    contextInjectorMessagesTransform: overrides.contextInjector ? makeHook(overrides.contextInjector) : undefined,
    thinkingBlockValidator: overrides.thinkingBlock ? makeHook(overrides.thinkingBlock) : undefined,
    toolPairValidator: overrides.toolPair ? makeHook(overrides.toolPair) : undefined,
  } as CreatedHooks
}

async function runHandler(
  hooks: CreatedHooks,
  messages: TestMessage[],
): Promise<void> {
  const handler = createMessagesTransformHandler({ hooks })
  await handler({} as never, { messages: messages as never })
}

describe("createMessagesTransformHandler", () => {
  it("runs all hooks in order when none throw", async () => {
    //#given
    const callOrder: string[] = []
    const hooks = makeHooks({
      contextInjector: async () => {
        callOrder.push("context-injector")
      },
      thinkingBlock: async () => {
        callOrder.push("thinking-block-validator")
      },
      toolPair: async () => {
        callOrder.push("tool-pair-validator")
      },
    })

    //#when
    await runHandler(hooks, [])

    //#then
    expect(callOrder).toEqual([
      "context-injector",
      "thinking-block-validator",
      "tool-pair-validator",
    ])
  })

  it("runs tool-pair-validator even when context-injector throws", async () => {
    //#given
    let toolPairRan = false
    const hooks = makeHooks({
      contextInjector: async () => {
        throw new Error("context-injector boom")
      },
      toolPair: async () => {
        toolPairRan = true
      },
    })

    //#when
    await runHandler(hooks, [])

    //#then
    expect(toolPairRan).toBe(true)
  })

  it("runs tool-pair-validator even when thinking-block-validator throws", async () => {
    //#given
    let toolPairRan = false
    const hooks = makeHooks({
      thinkingBlock: async () => {
        throw new Error("thinking-block boom")
      },
      toolPair: async () => {
        toolPairRan = true
      },
    })

    //#when
    await runHandler(hooks, [])

    //#then
    expect(toolPairRan).toBe(true)
  })

  it("repairs orphaned tool_use after upstream hook throws (regression for ses_22bd806)", async () => {
    //#given
    const messages: TestMessage[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "summary stand-in" }] },
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_01SRMQs3DUtVKWoSxC8bxxVA" }] },
      { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "toolu_01Lu5cHvRtEvzoifP1UVBVRb" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "next" }] },
    ]
    const hooks = makeHooks({
      contextInjector: async () => {
        throw new Error("simulating upstream hook failure")
      },
      toolPair: createRealToolPairValidator(),
    })

    //#when
    await runHandler(hooks, messages)

    //#then
    expect(messages).toHaveLength(5)
    expect(messages[2]).toEqual({
      info: { role: "user" },
      parts: [{
        type: "tool_result",
        toolUseId: "toolu_01SRMQs3DUtVKWoSxC8bxxVA",
        tool_use_id: "toolu_01SRMQs3DUtVKWoSxC8bxxVA",
        isError: true,
        content: [{ type: "text", text: "Tool output unavailable (context compacted)" }],
      }, {
        type: "text",
        text: "Recovered missing tool results. Continue from the repaired tool output.",
        synthetic: true,
      }],
    })
    expect(messages[4]?.parts[0]).toEqual({
      type: "tool_result",
      toolUseId: "toolu_01Lu5cHvRtEvzoifP1UVBVRb",
      tool_use_id: "toolu_01Lu5cHvRtEvzoifP1UVBVRb",
      isError: true,
      content: [{ type: "text", text: "Tool output unavailable (context compacted)" }],
    })
    expect(messages[4]?.parts[1]).toEqual({ type: "text", text: "next" })
  })

  it("does not throw when tool-pair-validator itself fails", async () => {
    //#given
    const hooks = makeHooks({
      toolPair: async () => {
        throw new Error("validator boom")
      },
    })

    //#when / #then
    await runHandler(hooks, [])
  })

  it("#given a completed assistant response tail #when messages transform runs again #then it does not synthesize a continuation user turn", async () => {
    //#given
    const messages: TestMessage[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "work on this" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "completed assistant answer" }] },
    ]

    //#when
    await runHandler(makeHooks({}), messages)

    //#then
    expect(messages).toHaveLength(2)
    expect(messages.at(-1)?.info.role).toBe("assistant")
  })

  it("#given an Anthropic Opus 4.7 history ends with an ordinary assistant tail #when messages transform runs #then it appends a synthetic user recovery turn", async () => {
    //#given
    const messages: TestMessage[] = [
      {
        info: {
          id: "msg_user",
          role: "user",
          sessionID: "ses_opus47_prefill",
          agent: "sisyphus",
          model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
          system: "system-prompt",
          tools: { bash: true },
        },
        parts: [{ type: "text", text: "finish the debugging report" }],
      },
      {
        info: {
          id: "msg_assistant",
          role: "assistant",
          sessionID: "ses_opus47_prefill",
        },
        parts: [{ type: "text", text: "## 정리 — 완료" }],
      },
    ]

    //#when
    await runHandler(makeHooks({}), messages)

    //#then
    expect(messages).toHaveLength(3)
    expect(messages.at(-1)?.info).toMatchObject({
      role: "user",
      sessionID: "ses_opus47_prefill",
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      system: "system-prompt",
      tools: { bash: true },
    })
    expect(messages.at(-1)?.parts[0]).toMatchObject({
      type: "text",
      text: "[internal] Continue from the previous assistant state.",
      synthetic: true,
    })
  })

  it("#given rejecting model metadata is only on the assistant tail #when messages transform runs #then it appends a synthetic user recovery turn", async () => {
    //#given
    const messages: TestMessage[] = [
      {
        info: {
          id: "msg_user_assistant_model_fallback",
          role: "user",
          sessionID: "ses_assistant_model_fallback",
          agent: "sisyphus",
          system: "system-prompt",
          tools: { bash: true },
        },
        parts: [{ type: "text", text: "continue" }],
      },
      {
        info: {
          id: "msg_assistant_model_fallback",
          role: "assistant",
          sessionID: "ses_assistant_model_fallback",
          model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
        },
        parts: [{ type: "text", text: "done" }],
      },
    ]

    //#when
    await runHandler(makeHooks({}), messages)

    //#then
    expect(messages).toHaveLength(3)
    expect(messages.at(-1)?.info).toMatchObject({
      role: "user",
      sessionID: "ses_assistant_model_fallback",
      agent: "sisyphus",
      model: { providerID: "internal", modelID: "assistant-prefill-guard" },
      system: "system-prompt",
      tools: { bash: true },
    })
    expect(messages.at(-1)?.parts[0]).toMatchObject({
      type: "text",
      text: "[internal] Continue from the previous assistant state.",
      synthetic: true,
    })
  })

  it("#given the assistant tail identifies a rejecting Anthropic model after an allowed user model #when messages transform runs #then it appends a synthetic user recovery turn", async () => {
    //#given
    const messages: TestMessage[] = [
      {
        info: {
          id: "msg_user_allowed_then_rejecting_assistant",
          role: "user",
          sessionID: "ses_allowed_then_rejecting_assistant",
          agent: "sisyphus",
          model: { providerID: "openai", modelID: "gpt-5.4" },
        },
        parts: [{ type: "text", text: "continue" }],
      },
      {
        info: {
          id: "msg_assistant_rejecting_metadata",
          role: "assistant",
          sessionID: "ses_allowed_then_rejecting_assistant",
          model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
        },
        parts: [{ type: "text", text: "done" }],
      },
    ]

    //#when
    await runHandler(makeHooks({}), messages)

    //#then
    expect(messages).toHaveLength(3)
    expect(messages.at(-1)?.info).toMatchObject({
      role: "user",
      sessionID: "ses_allowed_then_rejecting_assistant",
      agent: "sisyphus",
      model: { providerID: "openai", modelID: "gpt-5.4" },
    })
    expect(messages.at(-1)?.parts[0]).toMatchObject({
      type: "text",
      text: "[internal] Continue from the previous assistant state.",
      synthetic: true,
    })
  })

  it("#given an Anthropic-family provider history ends with a rejecting assistant tail #when messages transform runs #then it appends a synthetic user recovery turn", async () => {
    //#given
    const messages: TestMessage[] = [
      {
        info: {
          id: "msg_user_vertex_anthropic",
          role: "user",
          sessionID: "ses_vertex_anthropic",
          agent: "sisyphus",
          model: { providerID: "google-vertex-anthropic", modelID: "claude-opus-4-7" },
        },
        parts: [{ type: "text", text: "continue" }],
      },
      {
        info: {
          id: "msg_assistant_vertex_anthropic",
          role: "assistant",
          sessionID: "ses_vertex_anthropic",
        },
        parts: [{ type: "text", text: "done" }],
      },
    ]

    //#when
    await runHandler(makeHooks({}), messages)

    //#then
    expect(messages).toHaveLength(3)
    expect(messages.at(-1)?.info).toMatchObject({
      role: "user",
      sessionID: "ses_vertex_anthropic",
      agent: "sisyphus",
      model: { providerID: "google-vertex-anthropic", modelID: "claude-opus-4-7" },
    })
    expect(messages.at(-1)?.parts[0]).toMatchObject({
      type: "text",
      text: "[internal] Continue from the previous assistant state.",
      synthetic: true,
    })
  })

  it("#given rejecting model metadata uses direct provider and model fields #when messages transform runs #then it appends a synthetic user recovery turn", async () => {
    //#given
    const messages: TestMessage[] = [
      {
        info: {
          id: "msg_user_direct_model",
          role: "user",
          sessionID: "ses_direct_model",
          agent: "sisyphus",
          providerID: "anthropic",
          modelID: "claude-sonnet-4.6",
          system: "system-prompt",
          tools: { bash: true },
        },
        parts: [{ type: "text", text: "continue" }],
      },
      {
        info: {
          id: "msg_assistant_direct_model",
          role: "assistant",
          sessionID: "ses_direct_model",
        },
        parts: [{ type: "text", text: "done" }],
      },
    ]

    //#when
    await runHandler(makeHooks({}), messages)

    //#then
    expect(messages).toHaveLength(3)
    expect(messages.at(-1)?.info).toMatchObject({
      role: "user",
      sessionID: "ses_direct_model",
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
      system: "system-prompt",
      tools: { bash: true },
    })
    expect(messages.at(-1)?.parts[0]).toMatchObject({
      type: "text",
      text: "[internal] Continue from the previous assistant state.",
      synthetic: true,
    })
  })

  it("#given models that still allow assistant prefill or missing model metadata #when messages transform runs #then it keeps the assistant tail unchanged", async () => {
    //#given
    const scenarios: Array<{ name: string; userInfo: TestMessage["info"] }> = [
      {
        name: "openai",
        userInfo: {
          role: "user",
          model: { providerID: "openai", modelID: "gpt-5.4" },
        },
      },
      {
        name: "anthropic allowed",
        userInfo: {
          role: "user",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
        },
      },
      {
        name: "missing model",
        userInfo: { role: "user" },
      },
      {
        name: "non-anthropic provider",
        userInfo: {
          role: "user",
          model: { providerID: "opencode", modelID: "claude-opus-4-7" },
        },
      },
    ]

    for (const scenario of scenarios) {
      const messages: TestMessage[] = [
        { info: scenario.userInfo, parts: [{ type: "text", text: scenario.name }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "completed assistant answer" }] },
      ]

      //#when
      await runHandler(makeHooks({}), messages)

      //#then
      expect(messages, scenario.name).toHaveLength(2)
      expect(messages.at(-1)?.info.role, scenario.name).toBe("assistant")
    }
  })

  it("#given an internal compaction continuation reaches an assistant prefill tail #when messages transform runs #then it appends a synthetic user recovery turn", async () => {
    //#given
    const messages: TestMessage[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "work on this" }] },
      {
        info: { role: "user" },
        parts: [{
          type: "text",
          text: `[session recovered - continuing previous task]\n${OMO_INTERNAL_INITIATOR_MARKER}`,
          synthetic: true,
          metadata: { compaction_continue: true },
        }],
      },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "partial assistant tail" }] },
    ]

    //#when
    await runHandler(makeHooks({}), messages)

    //#then
    expect(messages.at(-1)?.info).toMatchObject({ role: "user" })
    expect(messages.at(-1)?.parts[0]).toMatchObject({
      type: "text",
      text: "[internal] Continue from the previous assistant state.",
      synthetic: true,
    })
  })

  it("#given an allowed model compaction continuation reaches an assistant tail #when messages transform runs #then it still appends a synthetic user recovery turn", async () => {
    //#given
    const messages: TestMessage[] = [
      {
        info: {
          role: "user",
          model: { providerID: "openai", modelID: "gpt-5.4" },
        },
        parts: [{
          type: "text",
          text: `[session recovered - continuing previous task]\n${OMO_INTERNAL_INITIATOR_MARKER}`,
          synthetic: true,
          metadata: { compaction_continue: true },
        }],
      },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "partial assistant tail" }] },
    ]

    //#when
    await runHandler(makeHooks({}), messages)

    //#then
    expect(messages.at(-1)?.info).toMatchObject({ role: "user" })
    expect(messages.at(-1)?.parts[0]).toMatchObject({
      type: "text",
      text: "[internal] Continue from the previous assistant state.",
      synthetic: true,
    })
  })
})

function createRealToolPairValidator(): TransformHook {
  const validator = createToolPairValidatorHook()
  const handler = validator["experimental.chat.messages.transform"]
  if (!handler) throw new Error("validator missing transform")
  return handler as never
}
