import { describe, expect, test } from "bun:test"
import registerFallbackMockProvider from "./task-runtime-fallback-mock-provider"

type Provider = Parameters<Parameters<typeof registerFallbackMockProvider>[0]["registerProvider"]>[1]

describe("runtime fallback mock preserves request identity after compaction", () => {
  test("a child model without its original identity prompt never consumes the parent script", async () => {
    const providers = new Map<string, Provider>()
    registerFallbackMockProvider({ registerProvider: (id, provider) => { providers.set(id, provider) } })
    const provider = providers.get("omo-fallback-mock")
    if (provider === undefined) throw new Error("Expected fallback fixture provider")

    // Compaction replaces the messages containing the child identity sentence.
    const result = await provider.streamSimple(
      { id: "dead-primary" },
      { messages: [{ content: "Compacted conversation summary" }] },
    ).result()

    expect(result.stopReason).toBe("error")
    const parent = await provider.streamSimple({ id: "parent" }, { messages: [{ content: "Run task" }] }).result()
    expect(parent.content).toMatchObject([{ type: "toolCall", name: "task" }])
  })
})
