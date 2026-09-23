import { describe, expect, it } from "bun:test"
import { extractV1Text, lastAssistantAgent, toV1MessageViews } from "./message-text"
import type { V2SessionMessage } from "./message-text"

const MESSAGES: V2SessionMessage[] = [
  { id: "m1", type: "user", time: { created: 1 }, text: "hello" } as V2SessionMessage,
  {
    id: "m2",
    type: "assistant",
    time: { created: 2, completed: 3 },
    agent: "sisyphus",
    model: { providerID: "anthropic", modelID: "claude" },
    content: [
      { type: "text", text: "answer" },
      { type: "tool", id: "c1", name: "grep", state: { status: "completed", input: { pattern: "x" } } },
    ],
    tokens: { input: 10, output: 5 },
    cost: 0,
  } as unknown as V2SessionMessage,
  { id: "m3", type: "system", time: { created: 4 }, text: "sys" } as V2SessionMessage,
]

describe("#given V2 session messages", () => {
  describe("#when converting to V1 views", () => {
    it("#then roles, tokens and tool parts survive", () => {
      // given
      // when
      const views = toV1MessageViews(MESSAGES, "ses-1")

      // then
      expect(views).toHaveLength(3)
      expect(views[0]?.info.role).toBe("user")
      expect(views[1]?.info.role).toBe("assistant")
      const assistant = views[1]?.info
      expect(assistant.role === "assistant" && assistant.tokens.input).toBe(10)
      const toolPart = views[1]?.parts.find((part) => part.type === "tool")
      expect(toolPart?.type === "tool" && toolPart.tool).toBe("grep")
      expect(toolPart?.type === "tool" && toolPart.state.status).toBe("completed")
    })
  })

  describe("#when extracting text and last agent", () => {
    it("#then skips synthetic parts and finds sisyphus", () => {
      // given
      const views = toV1MessageViews(MESSAGES, "ses-1")

      // when
      const text = extractV1Text(views[1]?.parts)

      // then
      expect(text).toBe("answer")
      expect(lastAssistantAgent(MESSAGES)).toBe("sisyphus")
      expect(lastAssistantAgent([])).toBeUndefined()
    })
  })
})
