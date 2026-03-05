import { describe, it, expect, beforeEach } from "bun:test"
import { ContextCollector } from "./collector"
import {
  createContextInjectorMessagesTransformHook,
} from "./injector"

describe("createContextInjectorMessagesTransformHook", () => {
  let collector: ContextCollector

  beforeEach(() => {
    collector = new ContextCollector()
  })

  const createMockMessage = (
    role: "user" | "assistant",
    text: string,
    sessionID: string
  ) => ({
    info: {
      id: `msg_${Date.now()}_${Math.random()}`,
      sessionID,
      role,
      time: { created: Date.now() },
      agent: "sisyphus",
      model: { providerID: "test", modelID: "test" },
      path: { cwd: "/", root: "/" },
    },
    parts: [
      {
        id: `part_${Date.now()}`,
        sessionID,
        messageID: `msg_${Date.now()}`,
        type: "text" as const,
        text,
      },
    ],
  })

  it("inserts synthetic part before text part in last user message", async () => {
    // given
    const hook = createContextInjectorMessagesTransformHook(collector)
    const sessionID = "ses_transform1"
    collector.register(sessionID, {
      id: "ulw",
      source: "keyword-detector",
      content: "Ultrawork context",
    })
    const messages = [
      createMockMessage("user", "First message", sessionID),
      createMockMessage("assistant", "Response", sessionID),
      createMockMessage("user", "Second message", sessionID),
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = { messages } as any

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then - synthetic part inserted before original text part
    expect(output.messages.length).toBe(3)
    expect(output.messages[2].parts.length).toBe(2)
    expect(output.messages[2].parts[0].text).toBe("Ultrawork context")
    expect(output.messages[2].parts[0].synthetic).toBe(true)
    expect(output.messages[2].parts[1].text).toBe("Second message")
  })

  it("uses deterministic synthetic part ID across repeated transforms", async () => {
    // given
    const hook = createContextInjectorMessagesTransformHook(collector)
    const sessionID = "ses_transform_deterministic"
    const baseMessage = createMockMessage("user", "Stable message", sessionID)

    collector.register(sessionID, {
      id: "ctx-1",
      source: "keyword-detector",
      content: "Injected context",
    })
    const firstOutput = {
      messages: [structuredClone(baseMessage)],
    }

    // when
    await hook["experimental.chat.messages.transform"]!({}, firstOutput)

    // then
    const firstSyntheticPart = firstOutput.messages[0].parts[0]
    expect(
      "synthetic" in firstSyntheticPart && firstSyntheticPart.synthetic === true
    ).toBe(true)

    // given
    collector.register(sessionID, {
      id: "ctx-2",
      source: "keyword-detector",
      content: "Injected context",
    })
    const secondOutput = {
      messages: [structuredClone(baseMessage)],
    }

    // when
    await hook["experimental.chat.messages.transform"]!({}, secondOutput)

    // then
    const secondSyntheticPart = secondOutput.messages[0].parts[0]
    expect(
      "synthetic" in secondSyntheticPart && secondSyntheticPart.synthetic === true
    ).toBe(true)
    expect(secondSyntheticPart.id).toBe(firstSyntheticPart.id)
  })

  it("does nothing when no pending context", async () => {
    // given
    const hook = createContextInjectorMessagesTransformHook(collector)
    const sessionID = "ses_transform2"
    const messages = [createMockMessage("user", "Hello world", sessionID)]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = { messages } as any

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    expect(output.messages.length).toBe(1)
  })

  it("does nothing when no user messages", async () => {
    // given
    const hook = createContextInjectorMessagesTransformHook(collector)
    const sessionID = "ses_transform3"
    collector.register(sessionID, {
      id: "ctx",
      source: "keyword-detector",
      content: "Context",
    })
    const messages = [createMockMessage("assistant", "Response", sessionID)]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = { messages } as any

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    expect(output.messages.length).toBe(1)
    expect(collector.hasPending(sessionID)).toBe(true)
  })

  it("consumes context after injection", async () => {
    // given
    const hook = createContextInjectorMessagesTransformHook(collector)
    const sessionID = "ses_transform4"
    collector.register(sessionID, {
      id: "ctx",
      source: "keyword-detector",
      content: "Context",
    })
    const messages = [createMockMessage("user", "Message", sessionID)]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = { messages } as any

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    expect(collector.hasPending(sessionID)).toBe(false)
  })
})
