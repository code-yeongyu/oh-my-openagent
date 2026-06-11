import { describe, expect, it } from "bun:test"
import { createAgent } from "./agent"
import type { AgentStreamItem, ModelClient } from "./types"

class FakeModelClient implements ModelClient {
  constructor(private readonly items: readonly AgentStreamItem[]) {}

  callModel(): {
    readonly getItemsStream: () => AsyncIterable<AgentStreamItem>
    readonly getText: () => Promise<string>
  } {
    const items = this.items
    return {
      async *getItemsStream(): AsyncIterable<AgentStreamItem> {
        yield* items
      },
      async getText(): Promise<string> {
        return "fallback"
      },
    }
  }
}

describe("Agent", () => {
  it("records messages and emits streaming deltas when a response arrives", async () => {
    // given
    const agent = createAgent({
      apiKey: "test-key",
      client: new FakeModelClient([
        {
          id: "msg_1",
          type: "message",
          status: "in_progress",
          content: [{ type: "output_text", text: "Hel" }],
        },
        {
          id: "msg_1",
          type: "message",
          status: "completed",
          content: [{ type: "output_text", text: "Hello" }],
        },
      ]),
    })
    const deltas: string[] = []
    agent.on("stream:delta", (delta) => deltas.push(delta))

    // when
    const response = await agent.send("Say hello")

    // then
    expect(response).toBe("Hello")
    expect(deltas).toEqual(["Hel", "lo"])
    expect(agent.getMessages()).toEqual([
      { role: "user", content: "Say hello" },
      { role: "assistant", content: "Hello" },
    ])
  })

  it("uses final text when item streaming has no message text", async () => {
    // given
    const agent = createAgent({
      apiKey: "test-key",
      client: new FakeModelClient([]),
    })

    // when
    const response = await agent.send("Use fallback")

    // then
    expect(response).toBe("fallback")
  })
})
