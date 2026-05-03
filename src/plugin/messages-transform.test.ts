import { describe, it, expect } from "bun:test"

import { createMessagesTransformHandler } from "./messages-transform"
import { createToolPairValidatorHook } from "../hooks/tool-pair-validator/hook"
import type { CreatedHooks } from "../create-hooks"

type TestPart = {
  type: string
  id?: string
  callID?: string
  tool_use_id?: string
  content?: string
  text?: string
}

type TestMessage = {
  info: { role: "assistant" | "user" }
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
  } as unknown as CreatedHooks
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
      parts: [{ type: "tool_result", tool_use_id: "toolu_01SRMQs3DUtVKWoSxC8bxxVA", content: "Tool output unavailable (context compacted)" }],
    })
    expect(messages[4]?.parts[0]).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_01Lu5cHvRtEvzoifP1UVBVRb",
      content: "Tool output unavailable (context compacted)",
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
})

function createRealToolPairValidator(): TransformHook {
  const validator = createToolPairValidatorHook()
  const handler = validator["experimental.chat.messages.transform"]
  if (!handler) throw new Error("validator missing transform")
  return handler as never
}
