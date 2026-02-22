const { describe, expect, test } = require("bun:test")

const { createMessagesTransformHandler } = require("./messages-transform")

function createMessageOutput() {
  return {
    messages: [
      {
        info: {
          id: "msg_1",
          role: "assistant",
          sessionID: "ses_1",
        },
        parts: [
          {
            id: "part_text",
            type: "text",
            text: "hello\uD800world",
          },
          {
            id: "part_tool",
            type: "tool",
            state: {
              status: "completed",
              output: "tool\uDC00output",
              title: "title\uD800",
              metadata: {
                nested: "meta\uD800",
              },
            },
          },
        ],
      },
    ],
  }
}

describe("createMessagesTransformHandler surrogate sanitization", () => {
  test("sanitizes all string fields in messages", async () => {
    const handler = createMessagesTransformHandler({ hooks: {} })
    const output = createMessageOutput()

    await handler({}, output)

    const message = output.messages[0]
    expect(message).toBeDefined()
    if (!message) return

    const textPart = message.parts.find((part) => part.id === "part_text")
    const toolPart = message.parts.find((part) => part.id === "part_tool")

    expect(textPart?.type).toBe("text")
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("hello\uFFFDworld")
    }

    expect(toolPart?.type).toBe("tool")
    if (
      toolPart?.type === "tool" &&
      toolPart.state &&
      toolPart.state.status === "completed"
    ) {
      expect(toolPart.state.output).toBe("tool\uFFFDoutput")
      expect(toolPart.state.title).toBe("title\uFFFD")
      expect(toolPart.state.metadata).toEqual({ nested: "meta\uFFFD" })
    }
  })

  test("sanitizes content injected by downstream transform hooks", async () => {
    const hooks = {
      contextInjectorMessagesTransform: {
        "experimental.chat.messages.transform": async (
          _input: Record<string, never>,
          output: { messages: Array<{ parts: Array<{ id: string; type: string; text?: string }> }> }
        ) => {
          const message = output.messages[0]
          if (!message) return

          message.parts.push({
            id: "part_injected",
            type: "text",
            text: "injected\uDC00text",
          })
        },
      },
    }

    const handler = createMessagesTransformHandler({ hooks })
    const output = createMessageOutput()

    await handler({}, output)

    const message = output.messages[0]
    expect(message).toBeDefined()
    if (!message) return

    const injectedPart = message.parts.find((part) => part.id === "part_injected")
    expect(injectedPart?.type).toBe("text")
    if (injectedPart?.type === "text") {
      expect(injectedPart.text).toBe("injected\uFFFDtext")
    }
  })
})

export {}
